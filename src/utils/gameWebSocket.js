/**
 * WebSocket client for Cloudflare GameRoom / LobbyRoom Durable Objects.
 *
 * Required env: VITE_GAME_WS_URL
 * e.g. http://127.0.0.1:8787 (wrangler dev) or https://card-wars-game.<account>.workers.dev
 */

const MAX_RECONNECT_DELAY_MS = 15_000

export function isGameWsConfigured() {
  return Boolean(import.meta.env.VITE_GAME_WS_URL?.trim())
}

/** @deprecated use isGameWsConfigured */
export function isGameWsEnabled() {
  return isGameWsConfigured()
}

export function getGameWsBaseUrl() {
  const base = import.meta.env.VITE_GAME_WS_URL?.trim()
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
}) {
  /** @type {WebSocket | null} */
  let ws = null
  let intentionalClose = false
  let retryAttempt = 0
  /** @type {ReturnType<typeof setTimeout> | null} */
  let retryTimer = null

  const clearRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  const connect = () => {
    if (intentionalClose) return
    onStatusChange?.('connecting')
    ws = new WebSocket(url)

    ws.addEventListener('open', () => {
      retryAttempt = 0
      ws.send(JSON.stringify({ type: 'join', clientId }))
    })

    ws.addEventListener('message', (event) => {
      try {
        onMessage?.(JSON.parse(String(event.data)))
      } catch {
        /* ignore malformed */
      }
    })

    ws.addEventListener('error', (e) => onError?.(e))

    ws.addEventListener('close', () => {
      ws = null
      onClose?.()
      if (intentionalClose) return
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
      ws?.close()
      ws = null
    },
    send(data) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected')
      }
      ws.send(data)
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
