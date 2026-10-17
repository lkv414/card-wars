/**
 * useAttack — атака своим существом по зоне противника.
 *
 * Worker (GameRoom Durable Object) — единственный авторитет. SQL-фоллбека нет.
 */

import { useCallback } from 'react'
import { canAttack } from './zoneOpposition'
import { canPlayerDealDamage } from './combat'
import { safePlayers } from '../../utils/safePlayer'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useAttack(game, { transport } = {}) {
  return useCallback(
    async (fromZone, cardId, toOpponentZone, toPlayerId = null) => {
      if (!game?.players) return { error: 'Игра не загружена' }

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
      if (!canPlayerDealDamage(me.player_order, aliveCount, game.current_turn ?? 0)) {
        return { error: 'Урон ещё недоступен (первый ход)' }
      }

      if (!canAttack(me.player_id, game.players, fromZone, opponent.player_id, toOpponentZone)) {
        return { error: 'Эта зона не противостоит цели' }
      }

      const ws = await runViaTransport(transport, 'attack', {
        fromZone: fromZone + 1,
        attackerCardId: String(cardId),
        toPlayerId: opponent.player_id,
        toZone: toOpponentZone + 1,
      })
      const wsErr = transportError(ws)
      if (wsErr) return wsErr
      const wsOk = transportOk(ws)
      if (wsOk) return wsOk

      return { error: 'Атака недоступна (обновите сервер)' }
    },
    [game, transport]
  )
}