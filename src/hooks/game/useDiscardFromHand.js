/**
 * useDiscardFromHand — сбросить карту из руки.
 *
 * Worker (GameRoom Durable Object) — единственный авторитет. SQL-фоллбека нет:
 * иначе карта списывалась бы дважды — в Worker и в таблице.
 */

import { useCallback } from 'react'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useDiscardFromHand(game, { transport } = {}) {
  return useCallback(
    async (cardIndex) => {
      if (!game?.id) return { error: 'Игра не загружена' }
      const me = game.players?.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }

      const ws = await runViaTransport(transport, 'discard_from_hand', { cardIndex })
      const wsErr = transportError(ws)
      if (wsErr) return wsErr
      const wsOk = transportOk(ws)
      if (wsOk) return wsOk

      return { error: 'Сброс из руки недоступен (обновите сервер)' }
    },
    [game, transport]
  )
}