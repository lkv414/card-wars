/**
 * useShuffleDeck — перемешать руку + колоду; при пустой колоде — сброс в колоду.
 *
 * Worker (GameRoom Durable Object) — единственный авторитет. SQL-фоллбека нет.
 */

import { useCallback } from 'react'
import { ensureGuestId } from '../../utils/guestSession'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useShuffleDeck(game, _reload, { transport } = {}) {
  return useCallback(async () => {
    if (!game?.id) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const me = game.players?.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }

    const ws = await runViaTransport(transport, 'shuffle_deck', {})
    const wsErr = transportError(ws)
    if (wsErr) return wsErr
    const wsOk = transportOk(ws)
    if (wsOk) return wsOk

    return { error: 'Перемешивание колоды недоступно (обновите сервер)' }
  }, [game, transport])
}