import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'
import { runGameAction } from './action-router'
import {
  parseClientMessage,
  serverMsg,
  type GameActionName,
} from './protocol'
import { assertPlayerInGame, getPlayerGameState } from './supabase'

interface SessionMeta {
  clientId: string
}

export class GameRoom extends DurableObject<Env> {
  /** game UUID — also available via ctx.id.name after hibernation */
  gameId = ''

  private resolveGameId(): string {
    if (this.gameId) return this.gameId
    const fromName = this.ctx.id.name
    if (fromName) {
      this.gameId = fromName
      return fromName
    }
    throw new Error('gameId missing on room')
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const fromQuery = url.searchParams.get('gameId')
    if (fromQuery) this.gameId = fromQuery
    else this.resolveGameId()

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

    const session = this.getSession(ws)

    try {
      if (msg.type === 'ping') {
        ws.send(serverMsg({ type: 'pong', requestId: msg.requestId }))
        return
      }

      if (msg.type === 'join') {
        const clientId = String(msg.clientId ?? '').trim()
        if (!clientId) {
          throw new Error('clientId required')
        }
        const gameId = this.resolveGameId()
        await assertPlayerInGame(this.env, gameId, clientId)
        ws.serializeAttachment({ clientId } satisfies SessionMeta)
        ws.send(
          serverMsg({
            type: 'joined',
            roomId: gameId,
            clientId,
            requestId: msg.requestId,
          })
        )
        await this.sendStateTo(ws, clientId, msg.requestId)
        this.broadcastPresence()
        return
      }

      if (msg.type === 'action') {
        if (!session?.clientId) {
          throw new Error('Send join before action')
        }
        await runGameAction(
          this.env,
          this.resolveGameId(),
          session.clientId,
          msg.action as GameActionName,
          msg.payload ?? {}
        )
        await this.broadcastStates(msg.requestId)
        return
      }

      ws.send(
        serverMsg({
          type: 'error',
          code: 'unknown_type',
          message: `Unknown message type`,
          requestId: msg.requestId,
        })
      )
    } catch (err) {
      ws.send(
        serverMsg({
          type: 'error',
          code: 'action_failed',
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

  private getSession(ws: WebSocket): SessionMeta | null {
    const data = ws.deserializeAttachment() as SessionMeta | null
    if (data?.clientId) return data
    return null
  }

  private async sendStateTo(ws: WebSocket, clientId: string, requestId?: string): Promise<void> {
    const game = await getPlayerGameState(this.env, this.resolveGameId(), clientId)
    const version = Number(game.version ?? 0)
    ws.send(serverMsg({ type: 'state', version, game, requestId }))
  }

  private onlineClientIds(): string[] {
    const ids = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      const session = this.getSession(ws)
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

  private async broadcastStates(requestId?: string): Promise<void> {
    const sockets = this.ctx.getWebSockets()
    await Promise.all(
      sockets.map(async (ws) => {
        const session = this.getSession(ws)
        if (!session?.clientId) return
        await this.sendStateTo(ws, session.clientId, requestId)
      })
    )
  }
}
