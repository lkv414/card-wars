import type { Env } from './env'
export { GameRoom } from './game-room'
export { LobbyRoom } from './lobby-room'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection',
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

    const gameMatch = url.pathname.match(/^\/game\/([^/]+)\/ws$/)
    if (gameMatch) {
      const gameId = gameMatch[1]
      const id = env.GAME_ROOM.idFromName(gameId)
      const stub = env.GAME_ROOM.get(id)
      const roomUrl = new URL(request.url)
      roomUrl.searchParams.set('gameId', gameId)
      return stub.fetch(new Request(roomUrl.toString(), request))
    }

    const lobbyMatch = url.pathname.match(/^\/lobby\/([^/]+)\/ws$/)
    if (lobbyMatch) {
      const lobbyId = lobbyMatch[1]
      const id = env.LOBBY_ROOM.idFromName(lobbyId)
      const stub = env.LOBBY_ROOM.get(id)
      const roomUrl = new URL(request.url)
      roomUrl.searchParams.set('lobbyId', lobbyId)
      return stub.fetch(new Request(roomUrl.toString(), request))
    }

    const lobbyNotifyMatch = url.pathname.match(/^\/lobby\/([^/]+)\/notify$/)
    if (lobbyNotifyMatch && request.method === 'POST') {
      const lobbyId = lobbyNotifyMatch[1]
      const id = env.LOBBY_ROOM.idFromName(lobbyId)
      const stub = env.LOBBY_ROOM.get(id)
      const roomUrl = new URL(request.url)
      roomUrl.pathname = '/internal/broadcast'
      roomUrl.searchParams.set('lobbyId', lobbyId)
      return stub.fetch(new Request(roomUrl.toString(), { method: 'POST' }))
    }

    return json(
      {
        service: 'card-wars-game',
        routes: ['/health', '/game/:gameId/ws', '/lobby/:lobbyId/ws', '/lobby/:lobbyId/notify'],
      },
      404
    )
  },
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  })
}
