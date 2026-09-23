/**
 * WebSocket client for Cloudflare GameRoom / LobbyRoom Durable Objects.
 *
 * Required env: VITE_GAME_WS_URL
 * e.g. http://127.0.0.1:8787 (wrangler dev) or https://card-wars-game.<account>.workers.dev
 */

const MAX_RECONNECT_DELAY_MS = 15_000
import { isOfflineTestMode, localWorkerBaseUrl } from './offlineMode'

export function isGameWsConfigured() {
  return isOfflineTestMode || Boolean(import.meta.env.VITE_GAME_WS_URL?.trim())
}

/** @deprecated use isGameWsConfigured */
export function isGameWsEnabled() {
  return isGameWsConfigured()
}

export function getGameWsBaseUrl() {
  const base = isOfflineTestMode
    ? localWorkerBaseUrl
    : import.meta.env.VITE_GAME_WS_URL?.trim()
  if (!base) {
    throw new Error('VITE_GAME_WS_URL не задан — realtime через Cloudflare Workers недоступен')
  }
  return base
}

function wsBaseHost(baseUrl) {
  const base = String(baseUrl ?? '').replace(/\/$/, '')
  if (!base) return null
  if (base.startsWith('wss://') || base.startsWith('ws://')) {
    return base.replace(/\/$/, '')
  }
  const protocol = base.startsWith('https') ? 'wss' : 'ws'
  const host = base.replace(/^https?:\/\//, '')
  return `${protocol}://${host}`
}

function httpBaseHost(baseUrl) {
  const base = String(baseUrl ?? '').replace(/\/$/, '')
  if (!base) return null
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return base.replace(/\/$/, '')
  }
  return `https://${base.replace(/^wss?:\/\//, '')}`
}

export function gameWsUrl(baseUrl, gameId) {
  const root = wsBaseHost(baseUrl)
  if (!root || !gameId) return null
  return `${root}/game/${gameId}/ws`
}

export function lobbyWsUrl(baseUrl, lobbyId) {
  const root = wsBaseHost(baseUrl)
  if (!root || !lobbyId) return null
  return `${root}/lobby/${lobbyId}/ws`
}

/** Ask LobbyRoom DO to push fresh snapshot to all connected clients. */
export async function notifyLobbyRoom(lobbyId) {
  if (!lobbyId) return
  const httpRoot = httpBaseHost(getGameWsBaseUrl())
  if (!httpRoot) return
  try {
    await fetch(`${httpRoot}/lobby/${lobbyId}/notify`, { method: 'POST' })
  } catch (err) {
    console.warn('[lobby] notify failed:', err?.message || err)
  }
}

/**
 * Reconnecting WebSocket — server-authoritative sync pattern:
 * join on connect → receive full state snapshot → auto-rejoin on disconnect.
 *
 * @param {object} options
 */
function createReconnectingSocket({
  url,
  clientId,
  onMessage,
  onError,
  onClose,
  onStatusChange,
  protocols,
}) {
  /** @type {WebSocket | null} */
  let ws = null
  let intentionalClose = false
  let retryAttempt = 0
  /** @type {ReturnType<typeof setTimeout> | null} */
  let retryTimer = null
  /** @type {Array<{ data: string }>} */
  const sendQueue = []
  /** @type {Array<{ resolve: () => void, reject: (err: Error) => void }>} */
  const readyWaiters = []
  let readyResolved = false

  const clearRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  const flushQueue = () => {
    while (sendQueue.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
      const { data } = sendQueue.shift()
      try {
        ws.send(data)
      } catch (err) {
        // best-effort: если send упал в OPEN, прокинем ошибку наружу через onError
        onError?.(err)
      }
    }
  }

  const resolveReady = () => {
    if (readyResolved) return
    readyResolved = true
    flushQueue()
    for (const waiter of readyWaiters) waiter.resolve()
    readyWaiters.length = 0
  }

  const rejectReady = (reason) => {
    for (const waiter of readyWaiters.splice(0)) waiter.reject(reason)
  }

  const connect = () => {
    if (intentionalClose) return
    onStatusChange?.('connecting')
    readyResolved = false
    ws = new WebSocket(url, protocols)

    ws.addEventListener('open', () => {
      retryAttempt = 0
      try {
        ws.send(JSON.stringify({ type: 'join', clientId }))
      } catch (err) {
        onError?.(err)
      }
      // Do not resolve readiness here: the Worker completes async auth and
      // state load before sending `joined`.
    })

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data))
        if (message?.type === 'joined') resolveReady()
        onMessage?.(message)
      } catch {
        /* ignore malformed */
      }
    })

    ws.addEventListener('error', (e) => onError?.(e))

    ws.addEventListener('close', () => {
      ws = null
      readyResolved = false
      onClose?.()
      if (intentionalClose) {
        rejectReady(new Error('WebSocket closed'))
        return
      }
      onStatusChange?.('reconnecting')
      const delay = Math.min(1000 * 2 ** retryAttempt, MAX_RECONNECT_DELAY_MS)
      retryAttempt += 1
      clearRetry()
      retryTimer = setTimeout(connect, delay)
    })
  }

  connect()

  return {
    close() {
      intentionalClose = true
      clearRetry()
      rejectReady(new Error('WebSocket closed'))
      ws?.close()
      ws = null
    },
    /** Promise, который резолвится когда сокет OPEN (или уже был OPEN). */
    whenReady() {
      if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve()
      return new Promise((resolve, reject) => {
        readyWaiters.push({ resolve, reject })
      })
    },
    send(data) {
      if (!ws) {
        // Буферизуем до reconnect — но только до retry-лимита, чтобы не утекала память.
        if (sendQueue.length < 64) sendQueue.push({ data })
        else throw new Error('WebSocket not connected (queue full)')
        return
      }
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data)
        } catch (err) {
          // Сокет мог закрыться прямо сейчас — буферизуем для следующего open.
          if (sendQueue.length < 64) sendQueue.push({ data })
          throw err
        }
        return
      }
      // CONNECTING / CLOSING — буферизуем и ждём open.
      if (sendQueue.length >= 64) throw new Error('WebSocket send queue full')
      sendQueue.push({ data })
    },
    get raw() {
      return ws
    },
  }
}

/** @param {object} options */
export function connectGameSocket(options) {
  return createReconnectingSocket(options)
}

/** @param {object} options */
export function connectLobbySocket(options) {
  return createReconnectingSocket(options)
}
