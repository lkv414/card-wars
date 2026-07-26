/**
 * useAttack — атака картой из своей зоны в зону противника.
 *
 * Логика:
 *  1. Найти атакующую карту в myZones[fromZone]
 *  2. Посчитать damage vs defense сумму живых defenders в oppZones[toOppZone]
 *  3. Если damage > defense → excess уходит в HP противника
 *  4. Уменьшить health визамых defenders, удалить уничтоженных
 *  5. Пометить атакующую карту tapped
 *  6. Если HP противника <= 0 → status='finished', winner_id = me
 *  7. Сохранить в game_zones (моя зона, зона противника) + game_players (HP)
 *  8. Обновить log через writeGameState
 *
 * Все 4 записи идут параллельно через Promise.all — это убирает частичную
 * запись при ошибке и снижает latency с 4×RTT до 1×RTT.
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { clampZones } from './format'
import { canAttack } from './zoneOpposition'
import { safePlayer, safePlayers } from '../../utils/safePlayer'

export function useAttack(game, writeGameState) {
  return useCallback(
    async (fromZone, cardId, toOpponentZone, toPlayerId = null) => {
      if (!game?.players) return { error: 'Игра не загружена' }
      await ensureGuestId()
      // safePlayers фильтрует null/undefined и фиксит health → .player_id безопасен
      const playersSafe = safePlayers(game.players)
      const me = playersSafe.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }

      // Определяем целевого игрока: явно переданный → ищем по id; иначе —
      // единственный оппонент (для обратной совместимости с 2-player вызовами).
      // Идём через safePlayer — он гарантированно не вернёт undefined и
      // подставит дефолтное health=25, если в Realtime-payload поле битое.
      // __isFallback=true означает «игрока не нашли, вернули фоллбек».
      let opponent
      if (toPlayerId) {
        opponent = safePlayer(game.players, toPlayerId)
        if (opponent.__isFallback) {
          return { error: 'Целевой игрок не найден' }
        }
        if (opponent.player_id === me.player_id) {
          return { error: 'Нельзя атаковать себя' }
        }
      } else {
        const others = game.players.filter((p) => p && p.player_id !== me.player_id)
        if (others.length === 0) return { error: 'Противник не найден' }
        if (others.length > 1) {
          return { error: 'Укажите toPlayerId: целевой игрок неоднозначен (3-4 игрока)' }
        }
        opponent = safePlayer(others, 0)
      }

      const myZones = clampZones(me.zones)
      const card = (myZones[fromZone] || []).find(
        (c) => c.id === cardId || c.instanceId === cardId
      )
      if (!card) return { error: 'Карта не найдена' }
      if (card.tapped) return { error: 'Карта уже использовалась' }

      // Валидация: эта зона реально противостоит цели?
      if (!canAttack(me.player_id, game.players, fromZone, opponent.player_id, toOpponentZone)) {
        return { error: 'Эта зона не противостоит цели (правила 3-4 игроков)' }
      }

      // clampZones защищает и от undefined (возвращает [[],[],[],[]])
      const oppZones = clampZones(opponent?.zones)
      // Только живые defenders защищают (health > 0)
      const liveDefenders = (oppZones[toOpponentZone] || []).filter(
        (c) => (c.health || 0) > 0
      )
      const damage = card.attack || 0
      const totalDefense = liveDefenders.reduce(
        (sum, c) => sum + (c.health || 0),
        0
      )

      // safePlayer гарантирует health: number, но опц. цепочка на всякий случай
      let newOppHealth = opponent?.health ?? 25
      const newOppZones = { ...oppZones }
      if (damage > totalDefense) {
        const excess = damage - totalDefense
        newOppHealth = (opponent?.health ?? 25) - excess
      }
      const surviving = (oppZones[toOpponentZone] || [])
        .map((c) => ({ ...c, health: (c.health || 0) - damage }))
        .filter((c) => c.health > 0)
      newOppZones[toOpponentZone] = surviving

      // Mark attacking card tapped
      myZones[fromZone] = myZones[fromZone].map((c) =>
        c.id === cardId || c.instanceId === cardId
          ? { ...c, tapped: true }
          : c
      )

      const newLog = [
        ...(game.game_state?.log || []),
        {
          timestamp: Date.now(),
          message: `${me?.nickname || 'Игрок'} атаковал ${card.name} (${damage} урона). Защита: ${totalDefense}`,
        },
      ]

      // Determine winner
      const patch = { game_state: { log: newLog } }
      if (newOppHealth <= 0) {
        patch.status = 'finished'
        patch.winner_id = me.player_id
        patch.ended_at = new Date().toISOString()
      }

      // Persist: 4 параллельных записи. Если хотя бы одна упала — откатываем
      // через reload() (Realtime дёрнет) и возвращаем ошибку.
      const [myZoneRes, oppHpRes, oppZoneRes, gameRes] = await Promise.all([
        supabase
          .from('game_zones')
          .update({ cards: myZones[fromZone] })
          .eq('game_id', game.id)
          .eq('player_id', me.player_id)
          .eq('zone_position', fromZone + 1),
        supabase
          .from('game_players')
          .update({ health: newOppHealth })
          .eq('game_id', game.id)
          .eq('player_id', opponent.player_id),
        supabase
          .from('game_zones')
          .update({ cards: newOppZones[toOpponentZone] })
          .eq('game_id', game.id)
          .eq('player_id', opponent.player_id)
          .eq('zone_position', toOpponentZone + 1),
        writeGameState(patch),
      ])

      const writeErr =
        myZoneRes.error || oppHpRes.error || oppZoneRes.error || gameRes?.error
      if (writeErr) {
        return { error: `Атака не сохранилась полностью: ${writeErr.message || writeErr}` }
      }
      return { success: true }
    },
    [game, writeGameState]
  )
}
