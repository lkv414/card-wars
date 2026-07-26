/**
 * useAttack — атака картой из своей зоны в зону противника.
 *
 * Логика:
 *  1. Найти атакующую карту в myZones[fromZone]
 *  2. Посчитать damage vs defense сумму defenders в oppZones[toOppZone]
 *  3. Если damage > defense → excess уходит в HP противника
 *  4. Уменьшить health визамых defenders, удалить уничтоженных
 *  5. Пометить атакующую карту tapped
 *  6. Если HP противника <= 0 → status='finished', winner_id = me
 *  7. Сохранить в game_zones (моя зона, зона противника) + game_players (HP)
 *  8. Обновить log через writeGameState
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { clampZones } from './format'

export function useAttack(game, writeGameState) {
  return useCallback(
    async (fromZone, cardId, toOpponentZone) => {
      if (!game?.players) return { error: 'Игра не загружена' }
      await ensureGuestId()
      const me = game.players.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }
      const opponent = game.players.find((p) => p.player_id !== me.player_id)
      if (!opponent) return { error: 'Противник не найден' }

      const myZones = clampZones(me.zones)
      const card = (myZones[fromZone] || []).find((c) => c.id === cardId)
      if (!card) return { error: 'Карта не найдена' }
      if (card.tapped) return { error: 'Карта уже использовалась' }

      const oppZones = clampZones(opponent.zones)
      const defenders = oppZones[toOpponentZone] || []
      const damage = card.attack || 0
      const totalDefense = defenders.reduce((sum, c) => sum + (c.health || 0), 0)

      let newOppHealth = opponent.health
      let newOppZones = { ...oppZones }
      if (damage > totalDefense) {
        const excess = damage - totalDefense
        newOppHealth = opponent.health - excess
      }
      const surviving = defenders
        .map((c) => ({ ...c, health: (c.health || 0) - damage }))
        .filter((c) => c.health > 0)
      newOppZones[toOpponentZone] = surviving

      // Mark attacking card tapped
      myZones[fromZone] = myZones[fromZone].map((c) =>
        c.id === cardId ? { ...c, tapped: true } : c
      )

      const newLog = [
        ...(game.game_state?.log || []),
        {
          timestamp: Date.now(),
          message: `${me.nickname || 'Игрок'} атаковал ${card.name} (${damage} урона). Защита: ${totalDefense}`,
        },
      ]

      // Determine winner
      const patch = { game_state: { log: newLog } }
      if (newOppHealth <= 0) {
        patch.status = 'finished'
        patch.winner_id = me.player_id
        patch.ended_at = new Date().toISOString()
      }

      // Persist: my zones (tapped), opponent health, opponent zones
      await supabase
        .from('game_zones')
        .update({ cards: myZones[fromZone] })
        .eq('game_id', game.id)
        .eq('player_id', me.player_id)
        .eq('zone_position', fromZone + 1)

      await supabase
        .from('game_players')
        .update({ health: newOppHealth })
        .eq('game_id', game.id)
        .eq('player_id', opponent.player_id)

      await supabase
        .from('game_zones')
        .update({ cards: newOppZones[toOpponentZone] })
        .eq('game_id', game.id)
        .eq('player_id', opponent.player_id)
        .eq('zone_position', toOpponentZone + 1)

      return writeGameState(patch)
    },
    [game, writeGameState]
  )
}