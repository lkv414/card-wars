import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'
import { parseClientMessage, serverMsg } from './protocol'
import { assertPlayerInLobby, callRpc, fetchLobbyRow } from './supabase'

interface SessionMeta {
  clientId: string
}

export class LobbyRoom extends DurableObject<Env> {
  lobbyId = ''

  /**
   * In-memory cache lobby-snapshot'а (PERFORMANCE_AUDIT_WORKERS V3):
   *   JOIN через PostgREST — медленный (~50-200 мс). Храним последний
   *   успешный snapshot и инвалидируем при каждом action (action всегда
   *   мутирует lobby, так что invalidate-by-write).
   */
  private cachedLobby: unknown = null
  private lobbyCacheTs = 0
  private static readonly LOBBY_CACHE_TTL_MS = 5_000

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
    // Durable Object hibernation уже закрыл сокет — не вызываем ws.close().
    try {
      this.broadcastPresence()
    } catch (err) {
      console.error('[LobbyRoom] broadcastPresence on close failed:', err)
    }
  }

  async webSocketError(ws: WebSocket, error?: unknown): Promise<void> {
    try {
      this.broadcastPresence()
    } catch (err) {
      console.error('[LobbyRoom] broadcastPresence on error failed:', err)
    }
  }

  private async runLobbyAction(
    clientId: string,
    action: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const lobbyId = this.resolveLobbyId()
    // Любой mutation-action инвалидирует snapshot-cache.
    this.invalidateLobbyCache()

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
          p_land_placement_rule: payload.landPlacementRule ?? 'strict',
        })
        return
      case 'reorder_lands':
        await callRpc(this.env, 'reorder_player_lands', {
          p_guest_id: clientId,
          p_lobby_id: lobbyId,
          p_land_ids: payload.landIds ?? payload.p_land_ids ?? [],
        })
        return
      case 'confirm_land_setup':
        await callRpc(this.env, 'confirm_land_setup', {
          p_guest_id: clientId,
          p_lobby_id: lobbyId,
          // Если игрок отправил пустой массив земель — bypass и считаем готовым
          // сразу. Это позволяет начать матч, даже если в колоде < 4 земель.
          p_bypass: payload.bypass === true || (Array.isArray(payload.landIds) && payload.landIds.length === 0),
        })
        return
      default:
        throw new Error(`Unknown lobby action: ${action}`)
    }
  }

  /**
   * Fetch (or вернуть cached) lobby snapshot. TTL 5с — auth-данные лобби
   * (player list, ready flags) меняются редко.
   *
   * Race fix (PERFORMANCE_AUDIT_WORKERS K5): `blockConcurrencyWhile` гарантирует,
   * что два параллельных вызова не сделают оба RPC — только первый пройдёт,
   * остальные подождут и получат его результат.
   */
  private async fetchLobbySnapshot(): Promise<unknown> {
    const now = Date.now()
    if (this.cachedLobby && now - this.lobbyCacheTs < LobbyRoom.LOBBY_CACHE_TTL_MS) {
      return this.cachedLobby
    }
    await this.ctx.blockConcurrencyWhile(async () => {
      const ts = Date.now()
      if (this.cachedLobby && ts - this.lobbyCacheTs < LobbyRoom.LOBBY_CACHE_TTL_MS) return
      const fresh = await fetchLobbyRow(this.env, this.resolveLobbyId())
      this.cachedLobby = fresh
      this.lobbyCacheTs = ts
    })
    return this.cachedLobby
  }

  /**
   * Инвалидировать cache — вызывается после каждого mutation action.
   */
  private invalidateLobbyCache(): void {
    this.cachedLobby = null
    this.lobbyCacheTs = 0
  }

  private onlineClientIds(): string[] {
    const ids = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== 1) continue
      const session = ws.deserializeAttachment() as SessionMeta | null
      if (session?.clientId) ids.add(session.clientId)
    }
    return [...ids]
  }

  private broadcastPresence(): void {
    const payload = serverMsg({ type: 'presence', onlineIds: this.onlineClientIds() })
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (ws.readyState !== 1) continue
        ws.send(payload)
      } catch {
        // сокет мог закрыться между проверкой и send() — игнорируем
      }
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
