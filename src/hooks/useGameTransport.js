/**
 * WebSocket transport for game room — server-authoritative state push.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  connectGameSocket,
  gameWsUrl,
  getGameWsBaseUrl,
  isGameWsConfigured,
} from '../utils/gameWebSocket'

const ACTION_TIMEOUT_MS = 45_000

export function useGameTransport(gameId, clientId, { onState, onError, onPresence } = {}) {
  const [status, setStatus] = useState(() => (isGameWsConfigured() ? 'connecting' : 'disabled'))
  const socketRef = useRef(null)
  const pendingRef = useRef(new Map())
  const seqRef = useRef(0)
  const onStateRef = useRef(onState)
  const onErrorRef = useRef(onError)
  const onPresenceRef = useRef(onPresence)

  useEffect(() => {
    onStateRef.current = onState
    onErrorRef.current = onError
    onPresenceRef.current = onPresence
  }, [onState, onError, onPresence])

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
        if (msg.requestId) {
          settlePending(msg.requestId, ({ reject }) =>
            reject(new Error(msg.message || 'WebSocket action failed')),
          )
        } else {
          onErrorRef.current?.(msg.message || 'WebSocket error')
        }
        return
      }
      if (msg?.type === 'joined') {
        setStatus('connected')
        return
      }
      if (msg?.type === 'presence') {
        onPresenceRef.current?.(msg.onlineIds ?? [])
        return
      }
      if (msg?.type === 'state') {
        onStateRef.current?.(msg.game, msg)
        settlePending(msg.requestId, ({ resolve }) => resolve(msg.game))
        return
      }
      // Объединённый frame (state + battle_events): теперь приходит в одном
      // ws.send() вместо двух. Клиент обрабатывает оба поля.
      if (msg?.type === 'state_with_battle') {
        onStateRef.current?.(msg.game, msg)
        settlePending(msg.requestId, ({ resolve }) => resolve(msg.game))
        return
      }
    },
    [settlePending],
  )

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect --
       setStatus() внутри эффекта — это sync с внешней системой
       (WebSocket lifecycle): «не сконфигурировано → disabled»,
       «нет URL → disabled», «перед коннектом → connecting». */
    if (!isGameWsConfigured() || !gameId || !clientId) {
      setStatus('disabled')
      return undefined
    }

    const url = gameWsUrl(getGameWsBaseUrl(), gameId)
    if (!url) {
      setStatus('disabled')
      return undefined
    }

    setStatus('connecting')
    /* eslint-enable react-hooks/set-state-in-effect */
    const socket = connectGameSocket({
      url,
      clientId,
      onMessage: handleMessage,
      onError: () => setStatus('error'),
      onClose: () => {
        setStatus('reconnecting')
      },
      onStatusChange: (next) => {
        setStatus(next === 'connected' ? 'connected' : next)
      },
    })
    socketRef.current = socket

    return () => {
      // pendingRef.current может быть переписан между эффектом и его cleanup,
      // но мы хотим отменить **актуальный** набор промисов в момент закрытия.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const pending = pendingRef.current
      for (const [, entry] of pending) {
        entry.reject(new Error('WebSocket closed'))
      }
      pending.clear()
      socket.close()
      socketRef.current = null
    }
  }, [gameId, clientId, handleMessage])

  const sendActionAsync = useCallback(async (action, payload = {}) => {
    const socket = socketRef.current
    if (!socket) {
      return Promise.reject(new Error('WebSocket not connected'))
    }

    // Дождаться реального OPEN — send() буферизует, но сервер ждёт `join` первым.
    try {
      await socket.whenReady()
    } catch (err) {
      return Promise.reject(err)
    }

    return new Promise((resolve, reject) => {
      seqRef.current += 1
      const requestId = `g${seqRef.current}`
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
        reject(new Error('Action timeout'))
      }, ACTION_TIMEOUT_MS)
    })
  }, [])

  return useMemo(
    () => ({
      enabled: isGameWsConfigured(),
      status,
      sendActionAsync,
    }),
    [status, sendActionAsync],
  )
}

export function wsConnectionLabel(status) {
  if (status === 'connected') return 'connected'
  if (status === 'connecting') return 'connecting'
  if (status === 'reconnecting') return 'reconnecting'
  if (status === 'disabled') return 'disconnected'
  return 'disconnected'
}