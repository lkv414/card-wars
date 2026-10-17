/**
 * useDrawCard — взять 1 карту из колоды за 1 действие.
 *
 * Worker (GameRoom Durable Object) — единственный авторитет. SQL-фоллбека нет.
 */

import { useCallback } from 'react'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useDrawCard(game, { transport } = {}) {
  return useCallback(async () => {
    if (!game?.id) return { error: 'Игра не загружена' }
    const me = game.players?.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }

    const ws = await runViaTransport(transport, 'draw_paid', {})
    const wsErr = transportError(ws)
    if (wsErr) return wsErr
    const wsOk = transportOk(ws)
    if (wsOk) return { ...wsOk, actions_remaining: undefined, hand_count: undefined }

    return { error: 'Платный добор недоступен (обновите сервер)' }
  }, [game, transport])
}