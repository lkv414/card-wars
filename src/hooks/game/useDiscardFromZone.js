/**
 * useDiscardFromZone — убрать карту с земли в сброс.
 *
 * Worker (GameRoom Durable Object) — единственный авторитет. SQL-фоллбека нет:
 * иначе карта списывалась бы дважды — в Durable Object и в таблице.
 */

import { useCallback } from 'react'
import { ensureGuestId } from '../../utils/guestSession'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useDiscardFromZone(game, _writeGameState, _reload, { transport } = {}) {
  return useCallback(
    async (zoneIndex, cardId) => {
      if (!game?.players) return { error: 'Игра не загружена' }
      await ensureGuestId()
      const me = game.players.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }

      const ws = await runViaTransport(transport, 'discard_from_zone', {
        zonePosition: zoneIndex + 1,
        cardId: String(cardId),
      })
      const wsErr = transportError(ws)
      if (wsErr) return wsErr
      const wsOk = transportOk(ws)
      if (wsOk) return wsOk

      return { error: 'Сброс с поля недоступен (обновите сервер)' }
    },
    [game, transport]
  )
}