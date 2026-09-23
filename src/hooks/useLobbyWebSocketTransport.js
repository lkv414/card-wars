/**
 * WebSocket transport for lobby room — server-authoritative lobby snapshots.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  connectLobbySocket,
  getGameWsBaseUrl,
  isGameWsConfigured,
  lobbyWsUrl,
} from '../utils/gameWebSocket'
import { isOfflineTestMode } from '../utils/offlineMode'

const ACTION_TIMEOUT_MS = 45_000

export function useLobbyWebSocketTransport(lobbyId, clientId, { onLobbyUpdate, onClosed, onPresence } = {}) {
  const [status, setStatus] = useState(() => (isGameWsConfigured() ? 'idle' : 'disabled'))
  const socketRef = useRef(null)
  const pendingRef = useRef(new Map())
  const seqRef = useRef(0)
  const onLobbyUpdateRef = useRef(onLobbyUpdate)
  const onClosedRef = useRef(onClosed)
  const onPresenceRef = useRef(onPresence)

  useEffect(() => {
    onLobbyUpdateRef.current = onLobbyUpdate
    onClosedRef.current = onClosed
    onPresenceRef.current = onPresence
  }, [onLobbyUpdate, onClosed, onPresence])

  const settlePending = useCallback((requestId, fn) => {
    if (!requestId) return
    const entry = pendingRef.current.get(requestId)
    if (!entry) return
    pendingRef.current.delete(requestId)
    fn(entry)
  }, [])

  const handleMessage = useCallback(
    (msg) => {
      if (msg?.type === 'error') {
        settlePending(msg.requestId, ({ reject }) =>
          reject(new Error(msg.message || 'Lobby action failed')),
        )
        return
      }
      if (msg?.type === 'joined') {
        setStatus('connected')
        return
      }
      if (msg?.type === 'closed') {
        onClosedRef.current?.(msg.reason)
        return
      }
      if (msg?.type === 'presence') {
        onPresenceRef.current?.(msg.onlineIds ?? [])
        return
      }
      if (msg?.type === 'lobby') {
        settlePending(msg.requestId, ({ resolve }) => resolve(msg.lobby))
        onLobbyUpdateRef.current?.(msg.lobby, msg)
      }
    },
    [settlePending],
  )

  const connect = useCallback(
    (id) => {
      if (!isGameWsConfigured()) {
        // WS не сконфигурирован — оставляем status='disabled', сокет не создаём.
        return
      }
      if (!id || !clientId) {
        // Недостаточно данных для подключения — не выходим в 'error',
        // это может быть просто ещё не успели восстановить сессию.
        return
      }

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
        onMessage: handleMessage,
        onError: () => setStatus('error'),
        onClose: () => {
          if (socketRef.current) setStatus('reconnecting')
        },
        onStatusChange: (next) => {
          if (next === 'reconnecting') setStatus('reconnecting')
          else if (next === 'connecting') setStatus('connecting')
        },
        protocols: isOfflineTestMode ? 'x-dev-bypass' : undefined,
      })
      socketRef.current = socket
    },
    [clientId, handleMessage],
  )

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }
    setStatus('idle')
  }, [])

  useEffect(() => () => {
    disconnect()
    const pending = pendingRef.current
    for (const [, entry] of pending) {
      entry.reject(new Error('Lobby WebSocket closed'))
    }
    pending.clear()
  }, [disconnect])

  const sendActionAsync = useCallback(async (action, payload = {}) => {
    const socket = socketRef.current
    if (!socket) {
      return Promise.reject(new Error('Lobby WebSocket not connected'))
    }

    // Дождаться реального OPEN — send() буферизует, но сервер ждёт `join` первым.
    try {
      await socket.whenReady()
    } catch (err) {
      return Promise.reject(err)
    }

    return new Promise((resolve, reject) => {
      seqRef.current += 1
      const requestId = `l${seqRef.current}`
      pendingRef.current.set(requestId, { resolve, reject })
      try {
        socket.send(JSON.stringify({ type: 'action', action, payload, requestId }))
      } catch (err) {
        pendingRef.current.delete(requestId)
        reject(err)
        return
      }
      setTimeout(() => {
        if (!pendingRef.current.has(requestId)) return
        pendingRef.current.delete(requestId)
        reject(new Error('Lobby action timeout'))
      }, ACTION_TIMEOUT_MS)
    })
  }, [])

  return useMemo(
    () => ({
      enabled: isGameWsConfigured(),
      status,
      connect,
      disconnect,
      sendActionAsync,
    }),
    [status, connect, disconnect, sendActionAsync],
  )
}