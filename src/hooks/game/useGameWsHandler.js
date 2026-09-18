/**
 * useGameWsHandler — единая точка для WS-push'ей.
 *
 * Связывает useGameTransport (сокет) + wsQueue (FIFO) + gameStore (applyServerState).
 * Гарантирует:
 * - FIFO порядок обработки WS-сообщений
 * - Все push'и идут через единый store.applyServerState
 * - WS-ошибки отображаются пользователю через toast
 *
 * Что обновлено по PERFORMANCE_AUDIT_WORKERS.md (K7):
 *   Battle events теперь приходят в объединённом фрейме `state_with_battle` —
 *   кладём весь msg в очередь, queue-worker достаёт `events`/`gameFinished`/
 *   `winnerId` и прокидывает в gameStore.applyServerState для эмиссии в UI.
 */
import { useEffect, useRef } from 'react'
import { useGameTransport, wsConnectionLabel } from '../useGameTransport'
import { createFifoQueue } from '../../utils/wsQueue'
import { useGameStore } from '../../store/gameStore'
import { gameDebugLog } from '../../utils/gameDebug'

export function useGameWsHandler({ gameId, clientId, onError }) {
  const queueRef = useRef(null)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const transport = useGameTransport(gameId, clientId, {
    onState: (rawGame, msg) => {
      // Кладём полное WS-сообщение в FIFO-очередь — это гарантирует
      // порядок обработки даже при быстрых push'ах.
      queueRef.current?.push({
        game: rawGame,
        requestId: msg?.requestId,
        events: msg?.events,
        gameFinished: msg?.gameFinished,
        winnerId: msg?.winnerId,
      })
    },
    onError: (message) => onErrorRef.current?.(message),
  })

  useEffect(() => {
    if (!gameId || !clientId) return undefined

    const queue = createFifoQueue(
      async (msg) => {
        if (msg?.game) {
          const source = msg.requestId ? 'ws:action' : 'ws:push'
          // Battle events (если есть) кладутся в store.applyServerState —
          // он сам решает, какие battleEvents держать. Раньше battle_events
          // приходили отдельным фреймом, теперь — встроены в state.
          const enriched = {
            ...msg.game,
            ...(msg.events ? { battle_events: msg.events } : {}),
            ...(typeof msg.gameFinished === 'boolean' ? { game_finished: msg.gameFinished } : {}),
            ...(msg.winnerId ? { winner_id: msg.winnerId } : {}),
          }
          useGameStore.getState().applyServerState(enriched, source)
          gameDebugLog('ws', 'state applied', {
            source,
            version: msg.game?.version,
            hasEvents: Array.isArray(msg.events) && msg.events.length > 0,
          })
        }
      },
      {
        onError: (err) => {
          gameDebugLog('ws', 'queue worker error', { error: err?.message || String(err) })
        },
      },
    )
    queueRef.current = queue

    return () => {
      queue.stop()
      queueRef.current = null
    }
  }, [gameId, clientId])

  return {
    transport,
    statusLabel: wsConnectionLabel(transport.status),
  }
}
