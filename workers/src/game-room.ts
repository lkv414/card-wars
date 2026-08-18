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
        console.log('[GameRoom] ws join', { clientId, gameId, requestId: msg.requestId })
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
    // Не вызываем ws.close() — Durable Object hibernation уже закрыл сокет.
    // Просто уведомляем остальных о новом составе presence.
    try {
      this.broadcastPresence()
    } catch (err) {
      console.error('[GameRoom] broadcastPresence on close failed:', err)
    }
  }

  async webSocketError(ws: WebSocket, error?: unknown): Promise<void> {
    // Аналогично: сокет уже закрыт hibernation'ом, не вызываем ws.close().
    try {
      this.broadcastPresence()
    } catch (err) {
      console.error('[GameRoom] broadcastPresence on error failed:', err)
    }
  }

  private getSession(ws: WebSocket): SessionMeta | null {
    const data = ws.deserializeAttachment() as SessionMeta | null
    if (data?.clientId) return data
    return null
  }

  /**
   * Safe-send: отправляет payload только в живые сокеты.
   * Если сокет уже закрыт (CLOSED/CLOSING) или send() падает,
   * ошибка тихо проглатывается — иначе один упавший клиент
   * роняет broadcastStates/broadcastPresence для всех.
   */
  private safeSend(ws: WebSocket, payload: string | ArrayBuffer): boolean {
    try {
      // WebSocket.OPEN === 1, CLOSING === 2, CLOSED === 3
      if (ws.readyState !== 1) return false
      ws.send(payload)
      return true
    } catch {
      return false
    }
  }

  private async sendStateTo(ws: WebSocket, clientId: string, requestId?: string): Promise<void> {
    try {
      const game = await getPlayerGameState(this.env, this.resolveGameId(), clientId)
      const version = Number(game.version ?? 0)
      // Диагностика: видны ли руки и зоны для этого клиента.
      const playersArr = Array.isArray(game?.players) ? game.players : []
      const visibility = playersArr.map((p) => ({
        id: p?.player_id,
        isSelf: p?.player_id === clientId,
        handLen: Array.isArray(p?.hand) ? p.hand.length : -1,
        zoneCount: Array.isArray(p?.zones) ? p.zones.length : 0,
        zoneCards: Array.isArray(p?.zones)
          ? p.zones.reduce((sum, z) => sum + (Array.isArray(z?.cards) ? z.cards.length : 0), 0)
          : 0,
      }))
      console.log('[GameRoom] sendStateTo', {
        clientId,
        version,
        requestId,
        players: visibility,
      })
      this.safeSend(ws, serverMsg({ type: 'state', version, game, requestId }))
    } catch (err) {
      console.error('[GameRoom] sendStateTo failed for', clientId, err)
    }
  }

  private onlineClientIds(): string[] {
    const ids = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== 1) continue
      const session = this.getSession(ws)
      if (session?.clientId) ids.add(session.clientId)
    }
    return [...ids]
  }

  private broadcastPresence(): void {
    const payload = serverMsg({ type: 'presence', onlineIds: this.onlineClientIds() })
    for (const ws of this.ctx.getWebSockets()) {
      this.safeSend(ws, payload)
    }
  }

  private async broadcastStates(requestId?: string): Promise<void> {
    // Собираем список живых сокетов с привязанным clientId один раз —
    // иначе при ошибке в одном send() состояние гонки может вернуть
    // сокет, который уже closed.
    const liveSockets = []
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== 1) continue
      const session = this.getSession(ws)
      if (session?.clientId) liveSockets.push({ ws, clientId: session.clientId })
    }
    await Promise.all(
      liveSockets.map(async ({ ws, clientId }) => {
        await this.sendStateTo(ws, clientId, requestId)
      })
    )
  }
}
