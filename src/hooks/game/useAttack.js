/**
 * useAttack — атака своим существом по зоне противника (RPC perform_attack).
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { canAttack } from './zoneOpposition'
import { canPlayerDealDamage } from './combat'
import { safePlayers } from '../../utils/safePlayer'
import { isRpcUnavailable } from './rpcUtils'
import { applyAttackPatch } from '../../utils/gameStatePatch'
import { publishGameSync } from '../../utils/gameSync'

export function useAttack(game, { patchGame, suppressRealtimeReload } = {}) {
  return useCallback(
    async (fromZone, cardId, toOpponentZone, toPlayerId = null) => {
      if (!game?.players) return { error: 'Игра не загружена' }
      await ensureGuestId()

      const playersSafe = safePlayers(game.players)
      const me = playersSafe.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }

      let opponent
      if (toPlayerId) {
        opponent = playersSafe.find((p) => p.player_id === toPlayerId)
        if (!opponent) return { error: 'Целевой игрок не найден' }
        if (opponent.player_id === me.player_id) return { error: 'Нельзя атаковать себя' }
      } else {
        const others = playersSafe.filter((p) => p.player_id !== me.player_id && (p.health ?? 0) > 0)
        if (others.length === 0) return { error: 'Противник не найден' }
        if (others.length > 1) {
          return { error: 'Укажите toPlayerId: целевой игрок неоднозначен (3-4 игрока)' }
        }
        opponent = others[0]
      }

      const aliveCount = playersSafe.filter((p) => (p.health ?? 0) > 0).length
      if (
        !canPlayerDealDamage(me.player_order, aliveCount, game.current_turn ?? 0)
      ) {
        return { error: 'Урон ещё недоступен (первый ход)' }
      }

      if (!canAttack(me.player_id, game.players, fromZone, opponent.player_id, toOpponentZone)) {
        return { error: 'Эта зона не противостоит цели' }
      }

      const { data, error: rpcErr } = await supabase.rpc('perform_attack', {
        p_game_id: game.id,
        p_player_id: me.player_id,
        p_from_zone: fromZone + 1,
        p_attacker_card_id: String(cardId),
        p_to_player_id: opponent.player_id,
        p_to_zone: toOpponentZone + 1,
      })

      if (rpcErr) {
        if (isRpcUnavailable(rpcErr)) {
          return { error: 'Атака недоступна (обновите сервер)' }
        }
        return { error: rpcErr.message }
      }
      if (data?.error) return { error: data.error }

      if (typeof patchGame === 'function') {
        patchGame((state) => applyAttackPatch(state, data))
      }

      // Suppress realtime reload for 8s to avoid interrupting battle animations
      if (typeof suppressRealtimeReload === 'function') {
        suppressRealtimeReload(8000)
      }

      await publishGameSync(game.id, {
        type: 'attack',
        version: data.version,
        actorId: me.player_id,
        rpcData: data,
      })

      return {
        success: true,
        damage: data.damage ?? 0,
        faceDamage: data.face_damage ?? 0,
        creatureKilled: Boolean(data.creature_killed),
        creatureDamaged: Boolean(data.creature_damaged),
        defenderHealth: data.defender_health,
        gameFinished: Boolean(data.game_finished),
      }
    },
    [game, patchGame, suppressRealtimeReload]
  )
}
