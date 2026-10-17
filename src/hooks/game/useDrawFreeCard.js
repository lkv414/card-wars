/**
 * useDrawFreeCard — бесплатный добор 1 карты (1 раз за ход).
 *
 * Worker (GameRoom Durable Object) — единственный авторитет. SQL-фоллбека нет:
 * иначе одно действие применилось бы дважды в двух источниках правды.
 */

import { useCallback } from 'react'
import { ensureGuestId } from '../../utils/guestSession'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useDrawFreeCard(game, _reload, { transport } = {}) {
  return useCallback(async () => {
    if (!game?.id) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const me = game.players?.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }

    const ws = await runViaTransport(transport, 'draw_free', {})
    const wsErr = transportError(ws)
    if (wsErr) return wsErr
    const wsOk = transportOk(ws, { draw_type: 'free' })
    if (wsOk) return wsOk

    return { error: 'Бесплатный добор недоступен (обновите сервер)' }
  }, [game, transport])
}