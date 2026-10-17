/**
 * useTurnControl — управление ходом.
 *
 * Действия:
 *   - endTurn: сменить active player (draw-фаза — на стороне Worker)
 *   - forfeit: сдаться
 *
 * Worker (GameRoom Durable Object) — единственный авторитет. SQL-фоллбека нет.
 */

import { useCallback } from 'react'
import { safePlayer, safePlayers } from '../../utils/safePlayer'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useTurnControl(game, { patchGame, transport } = {}) {
  /**
   * End turn: switch to next player.
   * Computes simple alternation: player1 -> player2 -> player1.
   */
  const endTurn = useCallback(async () => {
    if (!game?.players) return { error: 'Игра не загружена' }

    // === Optimistic patch: мгновенно переключаем current_player_id
    // локально, чтобы UI не ждал WS round-trip. WS broadcast потом
    // подтвердит (или откатит, если applyAction на сервере не принял).
    if (typeof patchGame === 'function') {
      const players = safePlayers(game.players)
      const currentIdx = players.findIndex((p) => p.player_id === game.current_player_id)
      if (currentIdx !== -1) {
        const nextIdx = (currentIdx + 1) % players.length
        const nextPlayer = players[nextIdx]
        if (nextPlayer) {
          patchGame((state) => ({
            ...state,
            current_player_id: nextPlayer.player_id,
            current_turn: (state?.current_turn ?? 0) + 1,
          }))
        }
      }
    }

    const ws = await runViaTransport(transport, 'end_turn', {})
    const wsErr = transportError(ws)
    if (wsErr) return wsErr
    const wsOk = transportOk(ws, { battleEvents: [], gameFinished: false })
    if (wsOk) return wsOk

    return { error: 'Передача хода недоступна (обновите сервер)' }
  }, [game, patchGame, transport])

  /**
   * Forfeit — сдаться. Текущий игрок выбывает (health=0). Игра продолжается
   * между оставшимися живыми; если остался ровно 1 — статус 'finished' и
   * winner_id = последний живой. Всю логику исполняет Worker.
   */
  const forfeit = useCallback(async () => {
    if (!game?.players) return { error: 'Игра не загружена' }
    const me = safePlayer(safePlayers(game.players), game.current_player_id)
    if (me.__isFallback) return { error: 'Сейчас не ваш ход' }

    const ws = await runViaTransport(transport, 'forfeit', {})
    const wsErr = transportError(ws)
    if (wsErr) return wsErr
    const wsOk = transportOk(ws)
    if (wsOk) return wsOk

    return { error: 'Сдача недоступна (обновите сервер)' }
  }, [game, transport])

  return { endTurn, forfeit }
}