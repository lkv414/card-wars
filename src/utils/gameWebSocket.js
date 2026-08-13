/**
 * WebSocket client for Cloudflare GameRoom / LobbyRoom Durable Objects.
 *
 * Env: VITE_GAME_WS_URL — e.g. http://127.0.0.1:8787 (wrangler dev) or wss://card-wars-game.<account>.workers.dev
 */

export function isGameWsEnabled() {
  return Boolean(import.meta.env.VITE_GAME_WS_URL?.trim())
}

export function getGameWsBaseUrl() {
  return import.meta.env.VITE_GAME_WS_URL?.trim() ?? ''
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

function createSocket({ url, clientId, onMessage, onError, onClose }) {
  const ws = new WebSocket(url)

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'join', clientId }))
  })

  ws.addEventListener('message', (event) => {
    try {
      onMessage?.(JSON.parse(String(event.data)))
    } catch {
      /* ignore */
    }
  })

  ws.addEventListener('error', (e) => onError?.(e))
  ws.addEventListener('close', () => onClose?.())

  return {
    close() {
      ws.close()
    },
    raw: ws,
  }
}

/** @param {object} options */
export function connectGameSocket(options) {
  return createSocket(options)
}

/** @param {object} options */
export function connectLobbySocket(options) {
  return createSocket(options)
}
