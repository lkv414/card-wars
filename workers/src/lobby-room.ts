import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'
import { parseClientMessage, serverMsg } from './protocol'


interface SessionMeta {
  clientId: string
}

export class LobbyRoom extends DurableObject<Env> {
  lobbyId = ''

  /** Local-only lobby state. It is kept in the DO, never in Supabase. */
  private localLobby: Record<string, unknown> | null = null
  private localGameState: Record<string, unknown> | null = null
  private localMode = false

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

    if (!this.localLobby) {
      const stored = await this.ctx.storage.get('localLobby') as Record<string, unknown> | null
      const storedGame = await this.ctx.storage.get('localGameState') as Record<string, unknown> | null
      if (stored) {
        this.localLobby = stored
        this.localMode = true
      }
      if (storedGame) this.localGameState = storedGame
    }

    if (request.method === 'POST' && url.pathname === '/internal/local/create') {
      const body = await request.json() as Record<string, unknown>
      const code = String(body.code ?? this.lobbyId)
      this.lobbyId = code
      this.localMode = true
      this.localLobby = {
        id: code,
        code,
        host_id: body.hostId,
        status: 'waiting',
        game_id: null,
        lobby_players: [this.localPlayer(body.hostId, body.nickname, body.deck)],
        updated_at: new Date().toISOString(),
      }
      await this.persistLocalLobby()
      return this.json(this.localLobby)
    }

    if (request.method === 'POST' && url.pathname === '/internal/local/join') {
      const body = await request.json() as Record<string, unknown>
      if (!this.localLobby) return this.json({ error: 'Лобби не найдено' }, 404)
      const players = Array.isArray(this.localLobby.lobby_players) ? this.localLobby.lobby_players : []
      const existing = players.find((p) => (p as { player_id?: unknown }).player_id === body.playerId)
      if (!existing && players.length >= 4) return this.json({ error: 'Лобби заполнено' }, 409)
      if (!existing) players.push(this.localPlayer(body.playerId, body.nickname, body.deck))
      this.localLobby = { ...this.localLobby, lobby_players: players, updated_at: new Date().toISOString() }
      await this.persistLocalLobby()
      await this.broadcastLobby()
      return this.json(this.localLobby)
    }

    if (request.method === 'GET' && url.pathname === '/internal/local/get') {
      return this.json(this.localLobby, this.localLobby ? 200 : 404)
    }

    if (request.method === 'GET' && url.pathname === '/internal/game-state') {
      return this.json(this.localGameState, this.localGameState ? 200 : 404)
    }

    if (request.method === 'POST' && url.pathname === '/internal/game-state') {
      const body = await request.json() as Record<string, unknown>
      const state = body.state && typeof body.state === 'object' ? body.state as Record<string, unknown> : body
      this.localGameState = state
      this.localMode = true
      await this.ctx.storage.put('localGameState', this.localGameState)
      return this.json({ ok: true, version: state.version ?? null })
    }

    if (request.method === 'GET' && url.pathname === '/internal/membership') {
      const playerId = url.searchParams.get('playerId')
      const players = Array.isArray(this.localLobby?.lobby_players)
        ? this.localLobby?.lobby_players as Array<Record<string, unknown>>
        : []
      const member = players.some((p) => p.player_id === playerId)
      return this.json({ member }, member ? 200 : 404)
    }

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

    const protocol = request.headers.get('sec-websocket-protocol')
    const headers = protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined
    return new Response(null, { status: 101, webSocket: client, headers })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message)
    const msg = parseClientMessage(raw)
    if (!msg) {
      ws.send(serverMsg({ type: 'error', code: 'bad_message', message: 'Invalid JSON message' }))
      return
    }

    const requestId = (msg as { requestId?: string }).requestId

    try {
      if (msg.type === 'ping') {
        ws.send(serverMsg({ type: 'pong', requestId: requestId }))
        return
      }

      if (msg.type === 'join') {
        const clientId = String(msg.clientId ?? '').trim()
        const lobbyId = this.resolveLobbyId()
        if (!clientId || !lobbyId) {
          throw new Error('clientId and lobbyId required')
        }
        if (!this.localMode) throw new Error('Лобби не инициализировано')
        ws.serializeAttachment({ clientId } satisfies SessionMeta)
        ws.send(
          serverMsg({
            type: 'joined',
            roomId: lobbyId,
            clientId,
            requestId: requestId,
          })
        )
        await this.sendLobbyTo(ws, requestId)
        this.broadcastPresence()
        return
      }

      if (msg.type === 'action') {
        const session = ws.deserializeAttachment() as SessionMeta | null
        if (!session?.clientId) {
          throw new Error('Send join before action')
        }
        await this.runLobbyAction(session.clientId, msg.action, msg.payload ?? {})
        await this.broadcastLobby(requestId)
        this.broadcastPresence()
        return
      }

      ws.send(
        serverMsg({
          type: 'error',
          code: 'unknown_type',
          message: 'Unknown message type',
          requestId: requestId,
        })
      )
    } catch (err) {
      ws.send(
        serverMsg({
          type: 'error',
          code: 'lobby_failed',
          message: err instanceof Error ? err.message : String(err),
          requestId: requestId,
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
    if (!this.localMode || !this.localLobby) throw new Error('Лобби не инициализировано')
    const players = Array.isArray(this.localLobby.lobby_players)
      ? [...(this.localLobby.lobby_players as Array<Record<string, unknown>>)]
      : []
    const player = players.find((p) => p.player_id === clientId)
    if (!player) throw new Error('Игрок не найден в лобби')

    if (action === 'set_ready') {
      player.ready = payload.ready === true
    } else if (action === 'leave') {
      this.localLobby = {
        ...this.localLobby,
        lobby_players: players.filter((p) => p.player_id !== clientId),
        updated_at: new Date().toISOString(),
      }
      await this.persistLocalLobby()
      return
    } else if (action === 'start_game') {
      if (this.localLobby.host_id !== clientId) throw new Error('Только хост может начать игру')
      const gameId = this.resolveLobbyId()
      // Игра против бота: серверный псевдо-игрок получает место в составе
      // лобби, но без колоды — её соберёт GameRoom из cards.json
      // (см. ensureBotSeats в game-room.ts). Клиент колоду боту не шлёт.
      if (payload.vsBot === true && !players.some((p) => p.is_bot === true)) {
        players.push(this.botLobbyPlayer())
      }
      this.localGameState = this.buildLocalGame(gameId, players)
      await this.ctx.storage.put('localGameState', this.localGameState)
      this.localLobby = {
        ...this.localLobby,
        status: 'in_game',
        game_id: gameId,
        updated_at: new Date().toISOString(),
      }
    } else {
      throw new Error(`Unknown lobby action: ${action}`)
    }

    this.localLobby = {
      ...this.localLobby,
      lobby_players: players,
      updated_at: new Date().toISOString(),
    }
    await this.persistLocalLobby()
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
    return this.localLobby
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

  private buildLocalGame(gameId: string, lobbyPlayers: Array<Record<string, unknown>>): Record<string, unknown> {
    const players = lobbyPlayers.map((lobbyPlayer, order) => {
      const deck = (lobbyPlayer.deck ?? {}) as Record<string, unknown>
      const cards = Array.isArray(deck.cards) ? deck.cards as Array<Record<string, unknown>> : []
      const hand = cards.slice(0, 5).map((card, index) => ({
        ...card,
        instanceId: String(card.instanceId ?? `${card.id ?? 'card'}-${order}-${index}`),
      }))
      const deckPile = cards.slice(5).map((card, index) => ({
        ...card,
        instanceId: String(card.instanceId ?? `${card.id ?? 'card'}-${order}-deck-${index}`),
      }))
      const lands = Array.isArray(deck.lands) ? deck.lands as Array<Record<string, unknown>> : []
      return {
        player_id: lobbyPlayer.player_id,
        nickname: lobbyPlayer.nickname ?? 'Игрок',
        position: null,
        health: 25,
        player_order: order + 1,
        // is_bot читает GameRoom: такое место он ведёт сам, по alarm.
        is_bot: lobbyPlayer.is_bot === true,
        hand,
        deck_pile: deckPile,
        deck_remaining: deckPile.length,
        discard_pile: [],
        actions_remaining: 2,
        free_draw_used: false,
        paid_draw_used: false,
        zones: [1, 2, 3, 4].map((position) => {
          const land = lands[position - 1] ?? null
          return {
            zone_position: position,
            cards: [],
            land_id: land?.id ?? land?.land_id ?? null,
            land_type: land?.land_type ?? 'any',
          }
        }),
      }
    })

    return {
      id: gameId,
      lobby_id: gameId,
      status: 'active',
      current_turn: 1,
      current_player_id: players[0]?.player_id ?? null,
      winner_id: null,
      version: 1,
      started_at: new Date().toISOString(),
      ended_at: null,
      turn_started_at: new Date().toISOString(),
      game_state: { firstPlayerId: players[0]?.player_id ?? null, turnPhase: 'main' },
      players,
    }
  }

  private async persistLocalLobby(): Promise<void> {
    if (this.localLobby) await this.ctx.storage.put('localLobby', this.localLobby)
  }

  private localPlayer(playerId: unknown, nickname: unknown, deck: unknown): Record<string, unknown> {
    return {
      player_id: String(playerId ?? ''),
      nickname: String(nickname || 'Игрок'),
      ready: false,
      deck: deck ?? {},
      joined_at: new Date().toISOString(),
    }
  }

  /**
   * Место бота в составе лобби. player_id со случайным суффиксом: клиент не
   * должен иметь возможности представиться ботом на WS-хендшейке.
   */
  private botLobbyPlayer(): Record<string, unknown> {
    return {
      player_id: `bot-${crypto.randomUUID().slice(0, 8)}`,
      nickname: 'Бот',
      ready: true,
      deck: {},
      is_bot: true,
      joined_at: new Date().toISOString(),
    }
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
