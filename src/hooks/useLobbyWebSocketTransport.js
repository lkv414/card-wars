/**
 * WebSocket transport for lobby room.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  connectLobbySocket,
  getGameWsBaseUrl,
  isGameWsEnabled,
  lobbyWsUrl,
} from '../utils/gameWebSocket'

const ACTION_TIMEOUT_MS = 45_000

export function useLobbyWebSocketTransport(lobbyId, clientId, { onLobbyUpdate } = {}) {
  const [status, setStatus] = useState(() => (isGameWsEnabled() ? 'idle' : 'disabled'))
  const socketRef = useRef(null)
  const pendingRef = useRef(new Map())
  const seqRef = useRef(0)
  const onLobbyUpdateRef = useRef(onLobbyUpdate)
  onLobbyUpdateRef.current = onLobbyUpdate

  const settlePending = useCallback((requestId, fn) => {
    if (!requestId) return
    const entry = pendingRef.current.get(requestId)
    if (!entry) return
    pendingRef.current.delete(requestId)
    fn(entry)
  }, [])

  const connect = useCallback(
    (id) => {
      if (!isGameWsEnabled() || !id || !clientId) return

      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }

      const url = lobbyWsUrl(getGameWsBaseUrl(), id)
      if (!url) return

      setStatus('connecting')
      const socket = connectLobbySocket({
        url,
        clientId,
        onMessage: (msg) => {
          if (msg?.type === 'error') {
            settlePending(msg.requestId, ({ reject }) =>
              reject(new Error(msg.message || 'Lobby action failed'))
            )
            return
          }
          if (msg?.type === 'joined') {
            setStatus('connected')
            return
          }
          if (msg?.type === 'lobby') {
            settlePending(msg.requestId, ({ resolve }) => resolve(msg.lobby))
            onLobbyUpdateRef.current?.(msg.lobby, msg)
          }
        },
        onError: () => setStatus('error'),
        onClose: () => setStatus('closed'),
      })
      socketRef.current = socket
    },
    [clientId, settlePending]
  )

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }
    setStatus('idle')
  }, [])

  useEffect(
    () => () => {
      disconnect()
      for (const [, entry] of pendingRef.current) {
        entry.reject(new Error('Lobby WebSocket closed'))
      }
      pendingRef.current.clear()
    },
    [disconnect]
  )

  const sendActionAsync = useCallback((action, payload = {}) => {
    const socket = socketRef.current
    if (!socket) {
      return Promise.reject(new Error('Lobby WebSocket not connected'))
    }

    return new Promise((resolve, reject) => {
      seqRef.current += 1
      const requestId = `l${seqRef.current}`
      pendingRef.current.set(requestId, { resolve, reject })
      socket.raw.send(JSON.stringify({ type: 'action', action, payload, requestId }))
      setTimeout(() => {
        if (!pendingRef.current.has(requestId)) return
        pendingRef.current.delete(requestId)
        reject(new Error('Lobby action timeout'))
      }, ACTION_TIMEOUT_MS)
    })
  }, [])

  return useMemo(
    () => ({
      enabled: isGameWsEnabled(),
      status,
      connect,
      disconnect,
      sendActionAsync,
    }),
    [status, connect, disconnect, sendActionAsync]
  )
}
