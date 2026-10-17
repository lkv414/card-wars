import type { Env } from './env'
export { GameRoom } from './game-room'
export { LobbyRoom } from './lobby-room'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection',
}

/**
 * Обогащает произвольный Response заголовками CORS — нужно для browser fetch из фронта.
 * Если response содержит webSocket (101 Switching Protocols), нужно скопировать его тоже,
 * иначе WebSocket-handshake сломается — новый Response без webSocket теряет апгрейд.
 */
function withCors(response: Response): Response {
  // Если response содержит WebSocket (WS upgrade) — копируем напрямую через конструктор
  // с webSocket property (поддерживается в Cloudflare Workers runtime, см. types).
  if ((response as Response & { webSocket?: WebSocket | null }).webSocket) {
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      headers.set(key, value)
    }
    const init: ResponseInit & { webSocket?: WebSocket | null } = {
      status: response.status,
      statusText: response.statusText,
      headers,
      webSocket: (response as Response & { webSocket?: WebSocket | null }).webSocket,
    }
    return new Response(null, init)
  }
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'card-wars-game' })
    }

    // Lobby state is DO-owned in every environment. Supabase is no longer a
    // lobby source of truth; the production config simply doesn't enable the
    // unauthenticated test catalog/game bypass.
    const localLobbyEnabled = true

    // Local/offline lobby API — state lives in the LobbyRoom DO, not Supabase.
    if (localLobbyEnabled && url.pathname === '/lobby' && request.method === 'POST') {
      const body = (await request.clone().json().catch(() => ({}))) as { code?: string }
      const lobbyId = String(body.code || 'local').toUpperCase()
      const id = env.LOBBY_ROOM.idFromName(lobbyId)
      const stub = env.LOBBY_ROOM.get(id)
      const roomUrl = new URL(request.url)
      roomUrl.pathname = '/internal/local/create'
      roomUrl.searchParams.set('lobbyId', lobbyId)
      return withCors(await stub.fetch(new Request(roomUrl.toString(), request)))
    }

    const localLobbyGet = url.pathname.match(/^\/lobby\/([^/]+)$/)
    if (
      localLobbyEnabled &&
      localLobbyGet &&
      request.method === 'GET' &&
      request.headers.get('Upgrade') !== 'websocket'
    ) {
      const lobbyId = localLobbyGet[1]
      const id = env.LOBBY_ROOM.idFromName(lobbyId)
      const stub = env.LOBBY_ROOM.get(id)
      const roomUrl = new URL(request.url)
      roomUrl.pathname = '/internal/local/get'
      roomUrl.searchParams.set('lobbyId', lobbyId)
      return withCors(await stub.fetch(new Request(roomUrl.toString(), request)))
    }

    const localLobbyJoin = url.pathname.match(/^\/lobby\/([^/]+)\/join$/)
    if (localLobbyEnabled && localLobbyJoin && request.method === 'POST') {
      const lobbyId = localLobbyJoin[1]
      const id = env.LOBBY_ROOM.idFromName(lobbyId)
      const stub = env.LOBBY_ROOM.get(id)
      const roomUrl = new URL(request.url)
      roomUrl.pathname = '/internal/local/join'
      roomUrl.searchParams.set('lobbyId', lobbyId)
      return withCors(await stub.fetch(new Request(roomUrl.toString(), request)))
    }

    const gameMatch = url.pathname.match(/^\/game\/([^/]+)\/ws$/)
    if (gameMatch) {
      const gameId = gameMatch[1]
      const id = env.GAME_ROOM.idFromName(gameId)
      const stub = env.GAME_ROOM.get(id)
      // Cloudflare Workers: для DO stub требуется внутренний URL — клонируем request
      // с новым URL, сохраняя заголовки (включая Upgrade) и body.
      const roomUrl = new URL(request.url)
      roomUrl.searchParams.set('gameId', gameId)
      return withCors(await stub.fetch(new Request(roomUrl.toString(), request)))
    }

    const lobbyMatch = url.pathname.match(/^\/lobby\/([^/]+)\/ws$/)
    if (lobbyMatch) {
      const lobbyId = lobbyMatch[1]
      const id = env.LOBBY_ROOM.idFromName(lobbyId)
      const stub = env.LOBBY_ROOM.get(id)
      const roomUrl = new URL(request.url)
      roomUrl.searchParams.set('lobbyId', lobbyId)
      return withCors(await stub.fetch(new Request(roomUrl.toString(), request)))
    }

    const lobbyNotifyMatch = url.pathname.match(/^\/lobby\/([^/]+)\/notify$/)
    if (lobbyNotifyMatch && request.method === 'POST') {
      const lobbyId = lobbyNotifyMatch[1]
      const id = env.LOBBY_ROOM.idFromName(lobbyId)
      const stub = env.LOBBY_ROOM.get(id)
      // Internal broadcast — НЕ upgrade, можно конструировать напрямую.
      const roomUrl = new URL(request.url)
      roomUrl.pathname = '/internal/broadcast'
      roomUrl.searchParams.set('lobbyId', lobbyId)
      return withCors(
        await stub.fetch(new Request(roomUrl.toString(), { method: 'POST' })),
      )
    }

    return withCors(
      json(
        {
          service: 'card-wars-game',
          routes: [
            '/health',
            '/game/:gameId/ws',
            '/lobby/:lobbyId/ws',
            '/lobby/:lobbyId/join',
             '/lobby/:lobbyId',
             '/lobby',
             '/lobby/:lobbyId/notify',
          ],
        },
        404,
      ),
    )
  },
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
