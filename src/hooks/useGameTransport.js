/**
 * WebSocket transport for game room — promise-based actions + live state push.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  connectGameSocket,
  gameWsUrl,
  getGameWsBaseUrl,
  isGameWsEnabled,
} from '../utils/gameWebSocket'

const ACTION_TIMEOUT_MS = 45_000

export function useGameTransport(gameId, clientId, { onState, onError } = {}) {
  const [status, setStatus] = useState(() => (isGameWsEnabled() ? 'connecting' : 'disabled'))
  const socketRef = useRef(null)
  const pendingRef = useRef(new Map())
  const seqRef = useRef(0)
  const onStateRef = useRef(onState)
  const onErrorRef = useRef(onError)
  onStateRef.current = onState
  onErrorRef.current = onError

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
            reject(new Error(msg.message || 'WebSocket action failed'))
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
      if (msg?.type === 'state') {
        onStateRef.current?.(msg.game, msg)
        settlePending(msg.requestId, ({ resolve }) => resolve(msg.game))
      }
    },
    [settlePending]
  )

  useEffect(() => {
    if (!isGameWsEnabled() || !gameId || !clientId) {
      setStatus('disabled')
      return undefined
    }

    const url = gameWsUrl(getGameWsBaseUrl(), gameId)
    if (!url) {
      setStatus('disabled')
      return undefined
    }

    setStatus('connecting')
    const socket = connectGameSocket({
      url,
      clientId,
      onMessage: handleMessage,
      onError: () => setStatus('error'),
      onClose: () => setStatus('closed'),
    })
    socketRef.current = socket

    return () => {
      for (const [, entry] of pendingRef.current) {
        entry.reject(new Error('WebSocket closed'))
      }
      pendingRef.current.clear()
      socket.close()
      socketRef.current = null
    }
  }, [gameId, clientId, handleMessage])

  const sendActionAsync = useCallback((action, payload = {}) => {
    const socket = socketRef.current
    if (!socket) {
      return Promise.reject(new Error('WebSocket not connected'))
    }

    return new Promise((resolve, reject) => {
      seqRef.current += 1
      const requestId = `g${seqRef.current}`
      pendingRef.current.set(requestId, { resolve, reject })
      socket.raw.send(JSON.stringify({ type: 'action', action, payload, requestId }))
      setTimeout(() => {
        if (!pendingRef.current.has(requestId)) return
        pendingRef.current.delete(requestId)
        reject(new Error('Action timeout'))
      }, ACTION_TIMEOUT_MS)
    })
  }, [])

  return useMemo(
    () => ({
      enabled: isGameWsEnabled(),
      status,
      sendActionAsync,
    }),
    [status, sendActionAsync]
  )
}

export function wsConnectionLabel(status) {
  if (status === 'connected') return 'connected'
  if (status === 'connecting') return 'connecting'
  if (status === 'disabled') return 'connecting'
  return 'disconnected'
}
