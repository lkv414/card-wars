import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'
import { parseClientMessage, serverMsg } from './protocol'
import { assertPlayerInLobby, callRpc } from './supabase'

interface SessionMeta {
  clientId: string
}

export class LobbyRoom extends DurableObject<Env> {
  lobbyId = ''

  private resolveLobbyId(): string {
    if (this.lobbyId) return this.lobbyId
    const fromName = this.ctx.id.name
    if (fromName) {
      this.lobbyId = fromName
      return fromName
    }
    throw new Error('lobbyId missing on room')
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const fromQuery = url.searchParams.get('lobbyId')
    if (fromQuery) this.lobbyId = fromQuery
    else this.resolveLobbyId()

    if (request.method === 'POST' && url.pathname.endsWith('/internal/broadcast')) {
      await this.broadcastLobby()
      this.broadcastPresence()
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message)
    const msg = parseClientMessage(raw)
    if (!msg) {
      ws.send(serverMsg({ type: 'error', code: 'bad_message', message: 'Invalid JSON message' }))
      return
    }

    try {
      if (msg.type === 'ping') {
        ws.send(serverMsg({ type: 'pong', requestId: msg.requestId }))
        return
      }

      if (msg.type === 'join') {
        const clientId = String(msg.clientId ?? '').trim()
        const lobbyId = this.resolveLobbyId()
        if (!clientId || !lobbyId) {
          throw new Error('clientId and lobbyId required')
        }
        await assertPlayerInLobby(this.env, lobbyId, clientId)
        ws.serializeAttachment({ clientId } satisfies SessionMeta)
        ws.send(
          serverMsg({
            type: 'joined',
            roomId: lobbyId,
            clientId,
            requestId: msg.requestId,
          })
        )
        await this.sendLobbyTo(ws, msg.requestId)
        this.broadcastPresence()
        return
      }

      if (msg.type === 'action') {
        const session = ws.deserializeAttachment() as SessionMeta | null
        if (!session?.clientId) {
          throw new Error('Send join before action')
        }
        await this.runLobbyAction(session.clientId, msg.action, msg.payload ?? {})
        await this.broadcastLobby(msg.requestId)
        this.broadcastPresence()
        return
      }

      ws.send(
        serverMsg({
          type: 'error',
          code: 'unknown_type',
          message: 'Unknown message type',
          requestId: msg.requestId,
        })
      )
    } catch (err) {
      ws.send(
        serverMsg({
          type: 'error',
          code: 'lobby_failed',
          message: err instanceof Error ? err.message : String(err),
          requestId: msg.requestId,
        })
      )
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    ws.close()
    this.broadcastPresence()
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    ws.close(1011, 'WebSocket error')
    this.broadcastPresence()
  }

  private async runLobbyAction(
    clientId: string,
    action: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const lobbyId = this.resolveLobbyId()

    switch (action) {
      case 'set_ready':
        await callRpc(this.env, 'set_lobby_player_ready', {
          p_guest_id: clientId,
          p_lobby_id: lobbyId,
          p_ready: payload.ready ?? true,
        })
        return
      case 'leave':
        await callRpc(this.env, 'leave_lobby', {
          p_guest_id: clientId,
          p_lobby_id: lobbyId,
        })
        return
      case 'start_game':
        await callRpc(this.env, 'start_game_for_lobby', {
          p_guest_id: clientId,
          p_lobby_id: lobbyId,
        })
        return
      default:
        throw new Error(`Unknown lobby action: ${action}`)
    }
  }

  private async fetchLobbySnapshot(): Promise<unknown> {
    const { url, key } = this.requireSupabase()
    const res = await fetch(
      `${url}/rest/v1/lobbies?id=eq.${this.resolveLobbyId()}&select=*,lobby_players(*)`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      }
    )
    if (!res.ok) {
      throw new Error(`Lobby fetch failed (${res.status})`)
    }
    const rows = await res.json()
    return Array.isArray(rows) ? rows[0] ?? null : rows
  }

  private requireSupabase() {
    const url = this.env.SUPABASE_URL?.trim()
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    if (!url || !key) {
      throw new Error('Supabase not configured on Worker')
    }
    return { url, key }
  }

  private onlineClientIds(): string[] {
    const ids = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      const session = ws.deserializeAttachment() as SessionMeta | null
      if (session?.clientId) ids.add(session.clientId)
    }
    return [...ids]
  }

  private broadcastPresence(): void {
    const payload = serverMsg({ type: 'presence', onlineIds: this.onlineClientIds() })
    for (const ws of this.ctx.getWebSockets()) {
      ws.send(payload)
    }
  }

  private async sendLobbyTo(ws: WebSocket, requestId?: string): Promise<void> {
    const lobby = await this.fetchLobbySnapshot()
    if (!lobby) {
      ws.send(serverMsg({ type: 'closed', reason: 'lobby_gone', requestId }))
      return
    }
    ws.send(serverMsg({ type: 'lobby', lobby, requestId }))
  }

  private async broadcastLobby(requestId?: string): Promise<void> {
    const lobby = await this.fetchLobbySnapshot()
    if (!lobby) {
      const closed = serverMsg({ type: 'closed', reason: 'lobby_gone', requestId })
      for (const ws of this.ctx.getWebSockets()) {
        ws.send(closed)
      }
      return
    }
    const payload = serverMsg({ type: 'lobby', lobby, requestId })
    for (const ws of this.ctx.getWebSockets()) {
      ws.send(payload)
    }
  }
}
