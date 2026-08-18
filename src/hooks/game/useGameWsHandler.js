/**
 * useGameWsHandler — единая точка для WS-push'ей.
 *
 * Связывает useGameTransport (сокет) + wsQueue (FIFO) + gameStore (applyServerState).
 * Гарантирует:
 * - FIFO порядок обработки WS-сообщений
 * - Все push'и идут через единый store.applyServerState
 * - WS-ошибки отображаются пользователю через toast
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
      queueRef.current?.push({ game: rawGame, requestId: msg?.requestId })
    },
    onError: (message) => onErrorRef.current?.(message),
  })

  useEffect(() => {
    if (!gameId || !clientId) return undefined

    const queue = createFifoQueue(
      async (msg) => {
        if (msg?.game) {
          const source = msg.requestId ? 'ws:action' : 'ws:push'
          useGameStore.getState().applyServerState(msg.game, source)
          gameDebugLog('ws', 'state applied', { source, version: msg.game?.version })
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
