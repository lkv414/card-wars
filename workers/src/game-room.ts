import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'
import {
  parseClientMessage,
  serverMsg,
  type GameActionName,
} from './protocol'
import { getCardIndex, getLands } from './catalog'
import { applyAction, isError as isEngineError } from './game-engine/engine'
import type {
  Action,
  ApplyResult,
  Card,
  CardCatalogEntry,
  GameState,
  PlayerState,
} from './game-engine/types.js'
import { buildBroadcastState } from './state-broadcast.js'
import { chooseBotAction, findBotId, BOT_NICKNAME } from './bot.js'
import { fillSeatWithCatalogDeck, needsDeck } from './deck.js'

interface SessionMeta {
  clientId: string
  /** Captured at WS handshake (header or subprotocol). Read in
   *  webSocketMessage via ws.deserializeAttachment(). */
  bypassAuth: boolean
}

/**
 * Action names accepted by the engine. Anything else returns an
 * unknown-action error to the client.
 */
const KNOWN_ACTIONS = new Set<GameActionName>([
  'play_card',
  'attack',
  'flip_card',
  'use_ability',
  'draw_free',
  'draw_paid',
  'shuffle_deck',
  'discard_from_hand',
  'discard_from_zone',
  'end_turn',
  'forfeit',
  'reorder_lands',
  'confirm_land_setup',
])

/**
 * Sessions are transient (Этап 6 плана v2): the authoritative state lives in
 * this Durable Object's SQLite storage for as long as the room is alive, and
 * Supabase is no longer involved. Snapshotting is still performed after every
 * action — SQLite writes are local and cheap, and DO eviction mid-game must
 * not lose progress.
 */
const SNAPSHOT_EVERY_N_ACTIONS = 1

/** SQLite key holding the serialized session state. */
const STORAGE_KEY_GAME = 'game'

/**
 * How long an unwatched room is kept before its storage is dropped. The room is
 * only cleaned by the alarm, so a party that nobody reconnects to disappears on
 * its own (parties are transient by design).
 */
const ROOM_TTL_MS = 30 * 60 * 1000

/**
 * How often the alarm re-checks a room that still has live sockets. Cheap:
 * the alarm only reads storage when it decides to clean up.
 */
const WATCHED_ROOM_RECHECK_MS = 5 * 60 * 1000

/**
 * Pause between two bot actions. Bot turns are driven one action per alarm tick
 * so the party reads like a real opponent (and so a DO eviction mid-turn is
 * harmless — the next alarm re-loads the session and continues).
 */
const BOT_STEP_MS = 900

export class GameRoom extends DurableObject<Env> {
  /** game id — also available via ctx.id.name after hibernation */
  gameId = ''

  /** In-memory authoritative state. `null` until first loadGame() call. */
  private currentGame: GameState | null = null

  /** Number of mutations since the last persisted snapshot. */
  private actionsSinceSnapshot = 0

  /** Bounded idempotency window for reconnecting clients. */
  private processedRequests = new Set<string>()

  /** Per-player join status — maps clientId → true. Cleared on close. */
  private joined = new Set<string>()

  /**
   * Dev-only flag. Set on the first join that arrives with the
   * `x-dev-bypass-auth` handshake flag (or on a `local-*` room). When true the
   * room never asks the lobby for membership — it creates an in-memory game so
   * a browser alone can exercise the sync/broadcast path.
   */
  private devMode = false

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

    // HTTP state read: replaces the legacy `get_player_game_state` RPC.
    // Used by the client as the initial load (and as a WS fallback) — fog of
    // war is applied per viewer, exactly like the WS push.
    if (request.headers.get('Upgrade') !== 'websocket') {
      const wantsState = url.searchParams.get('state') === '1'
      if (!wantsState) return new Response('Expected WebSocket', { status: 426 })
      const playerId = (url.searchParams.get('playerId') ?? '').trim()
      if (!playerId) {
        return json({ error: 'playerId required' }, 400)
      }
      try {
        const allowed = await this.canReadGame(playerId)
        if (!allowed) return json({ error: 'Нет доступа к игре' }, 403)
        if (!this.currentGame) await this.loadGame()
        if (!this.currentGame) return json({ error: 'Игра не найдена' }, 404)
        return json(buildBroadcastState(this.currentGame, playerId))
      } catch (err) {
        return json(
          { error: err instanceof Error ? err.message : String(err) },
          404,
        )
      }
    }

    // Capture WS-handshake headers / subprotocol ONCE so the rest of the
    // session can use them. The webSocketMessage handler doesn't receive
    // the original Request, and trying to read it from there is a
    // ReferenceError waiting to happen (a previous bug: `request` was
    // used in webSocketMessage and crashed with "request is not defined"
    // on every join, which is why sync between clients was broken).
    const devBypassAllowed =
      this.env.ENVIRONMENT !== 'production' && this.env.ALLOW_DEV_BYPASS === '1'
    const upgradeHeaders = {
      bypassAuth:
        devBypassAllowed &&
        (
          request.headers.get('x-dev-bypass-auth') === '1' ||
          request.headers.get('sec-websocket-protocol') === 'x-dev-bypass'
        ),
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)

    // Stash handshake metadata on the WS attachment so webSocketMessage
    // and webSocketClose can read it without an explicit Request object.
    server.serializeAttachment({
      clientId: '',
      bypassAuth: upgradeHeaders.bypassAuth,
    } satisfies SessionMeta)

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

    const session = this.getSession(ws)
    const requestId = (msg as { requestId?: string }).requestId

    try {
      if (msg.type === 'ping') {
        ws.send(serverMsg({ type: 'pong', requestId: requestId }))
        return
      }

      if (msg.type === 'join') {
        const clientId = String(msg.clientId ?? '').trim()
        if (!clientId) {
          throw new Error('clientId required')
        }
        const gameId = this.resolveGameId()
        console.log('[GameRoom] ws join', { clientId, gameId, requestId: requestId })
        // Read dev-bypass flag from the WS attachment (captured at
        // handshake in fetch()). The previous code referenced `request`
        // here which is a ReferenceError — every join used to crash.
        const meta = this.getSession(ws) ?? { clientId: '', bypassAuth: false }
        const bypass = meta.bypassAuth || this.isLocalTestRoom(gameId)
        if (!bypass) {
          const nativeMember = await this.isNativeLobbyMember(gameId, clientId)
          if (!nativeMember) throw new Error('Нет доступа к игре')
          await this.loadGame()
        } else {
          // Dev-only: no lobby. Spin up an in-memory game so we can test
          // broadcast/sync between two connected clients.
          this.devMode = true
          await this.ensureDevGame(clientId)
        }
        this.joined.add(clientId)
        // Persist clientId back into the attachment so subsequent
        // webSocketMessage calls can read it.
        ws.serializeAttachment({
          clientId,
          bypassAuth: meta.bypassAuth,
        } satisfies SessionMeta)
        ws.send(
          serverMsg({
            type: 'joined',
            roomId: gameId,
            clientId,
            requestId: requestId,
          }),
        )
        if (await this.ensureBotSeats()) await this.publishCurrentState()
        await this.sendStateTo(ws, clientId, requestId)
        this.broadcastPresence()
        await this.armBotIfItsTurn()
        return
      }

      if (msg.type === 'action') {
        if (!session?.clientId) {
          throw new Error('Send join before action')
        }
        // DO may have been evicted (idle timeout) между join и action.
        // Race fix (PERFORMANCE_AUDIT_WORKERS K2): под blockConcurrencyWhile,
        // чтобы проверка+загрузка были атомарны — между `if (!currentGame)`
        // и `await loadGame()` не может вклиниться eviction.
        if (!this.currentGame) {
          try {
            await this.ctx.blockConcurrencyWhile(async () => {
              if (this.currentGame) return
              if (this.devMode) {
                await this.ensureDevGame(session.clientId)
              } else {
                await this.loadGame()
              }
            })
            // Catch the actor up to where the rest of the room already is.
            await this.sendStateTo(ws, session.clientId)
          } catch (e) {
            console.error('[GameRoom] rehydrate before action failed:', e)
            throw new Error('Game not loaded and rehydrate failed')
          }
        }
        await this.handleAction(ws, msg.action as GameActionName, msg.payload ?? {}, session.clientId, requestId)
        await this.armBotIfItsTurn()
        return
      }

      ws.send(
        serverMsg({
          type: 'error',
          code: 'unknown_type',
          message: `Unknown message type`,
          requestId: requestId,
        }),
      )
    } catch (err) {
      ws.send(
        serverMsg({
          type: 'error',
          code: 'action_failed',
          message: err instanceof Error ? err.message : String(err),
          requestId: requestId,
        }),
      )
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const session = this.getSession(ws)
    if (session?.clientId) this.joined.delete(session.clientId)
    try {
      this.broadcastPresence()
      await this.armCleanupIfUnwatched()
    } catch (err) {
      console.error('[GameRoom] broadcastPresence on close failed:', err)
    }
  }

  async webSocketError(ws: WebSocket, error?: unknown): Promise<void> {
    const session = this.getSession(ws)
    if (session?.clientId) this.joined.delete(session.clientId)
    try {
      this.broadcastPresence()
      await this.armCleanupIfUnwatched()
    } catch (err) {
      console.error('[GameRoom] broadcastPresence on error failed:', err)
    }
    void error
  }

  /**
   * Alarm handler — drives bot turns and cleans up abandoned rooms.
   *
   * Parties are transient: storage survives DO eviction, but not an empty room.
   * Live sockets postpone the cleanup (and re-check later); a bot turn is
   * advanced one action per tick, then the next tick is armed.
   */
  async alarm(): Promise<void> {
    try {
      if (!this.currentGame) {
        const stored = await this.ctx.storage.get(STORAGE_KEY_GAME)
        if (!stored) return
        await this.loadGame()
      }

      let didBotWork = false
      const game = this.currentGame
      if (!game) return
      const botId = findBotId(game)
      if (botId && game.status === 'active' && game.current_player_id === botId) {
        await this.ensureBotSeats()
        didBotWork = await this.runBotStep(botId)
        const stillBot =
          this.currentGame?.status === 'active' && this.currentGame.current_player_id === botId
        if (stillBot) {
          await this.scheduleBotStep()
          return
        }
      }

      if (this.liveSocketCount() > 0) {
        await this.ctx.storage.setAlarm(Date.now() + WATCHED_ROOM_RECHECK_MS)
        return
      }
      if (didBotWork) {
        // Игрок отключился, пока бот доигрывал свой ход — даём шанс вернуться.
        await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS)
        return
      }

      await this.ctx.storage.deleteAll()
      console.log('[GameRoom] alarm: session storage cleaned', { gameId: this.gameId })
      this.currentGame = null
      this.joined.clear()
      this.processedRequests.clear()
      this.actionsSinceSnapshot = 0
    } catch (err) {
      console.error('[GameRoom] alarm failed:', err)
    }
  }

  /**
   * Advance the bot by exactly one action. Returns false when nothing was
   * applied (not the bot's turn, no legal move, engine refusal).
   */
  private async runBotStep(botId: string): Promise<boolean> {
    const game = this.currentGame
    if (!game) return false
    if (game.status !== 'active' || game.current_player_id !== botId) return false

    const chosen = chooseBotAction(game, botId)
    // `end_turn` is a guaranteed legal fallback: if the chosen move is refused
    // by the engine we still hand the turn back instead of stalling the party.
    const attempts: Action[] = chosen ? [chosen, { type: 'end_turn' }] : [{ type: 'end_turn' }]

    for (const action of attempts) {
      const result = applyAction(game, action, botId)
      if (isEngineError(result)) {
        console.error('[GameRoom] bot action refused', { action: action.type, error: result.error })
        continue
      }
      const applyResult = result as ApplyResult
      this.currentGame = applyResult.state
      this.actionsSinceSnapshot += 1
      await this.broadcastPersonalizedStates(applyResult)
      try {
        await this.persistSnapshot()
      } catch (err) {
        console.error('[GameRoom] bot persistSnapshot failed:', err)
      }
      return true
    }
    return false
  }

  /** Arm the next bot action. */
  private async scheduleBotStep(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + BOT_STEP_MS)
  }

  /** Hand every bot seat a catalog deck if it has none yet. */
  private async ensureBotSeats(): Promise<boolean> {
    const game = this.currentGame
    if (!game) return false
    if (!game.players.some((player) => player.is_bot && needsDeck(player))) return false
    // eslint-disable-next-line react-hooks/immutability -- DO mutation, not React state
    this.currentGame = {
      ...game,
      players: game.players.map((player) =>
        player.is_bot && needsDeck(player) ? fillSeatWithCatalogDeck(player) : player,
      ),
    }
    return true
  }

  /** Push the current in-memory state to every viewer and persist it. */
  private async publishCurrentState(): Promise<void> {
    if (!this.currentGame) return
    await this.broadcastPersonalizedStates({ state: this.currentGame })
    try {
      await this.persistSnapshot()
    } catch (err) {
      console.error('[GameRoom] publishCurrentState persist failed:', err)
    }
  }

  /**
   * If the party reached the bot's turn, arm the alarm that will play it.
   * Called after every state change (join, action) — a human ending their turn
   * must not leave the bot hanging until the socket closes.
   */
  private async armBotIfItsTurn(): Promise<void> {
    const game = this.currentGame
    if (!game || game.status !== 'active') return
    const botId = findBotId(game)
    if (!botId || game.current_player_id !== botId) return
    await this.scheduleBotStep()
  }

  private getSession(ws: WebSocket): SessionMeta | null {
    const data = ws.deserializeAttachment() as SessionMeta | null
    if (data && typeof data === 'object' && 'clientId' in data) return data
    return null
  }

  /**
   * Safe-send: отправляет payload только в живые сокеты.
   */
  private safeSend(ws: WebSocket, payload: string | ArrayBuffer): boolean {
    try {
      if (ws.readyState !== 1) return false
      ws.send(payload)
      return true
    } catch {
      return false
    }
  }

  private liveSocketCount(): number {
    let count = 0
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === 1) count += 1
    }
    return count
  }

  /** Arm the cleanup alarm only when nobody is watching. */
  private async armCleanupIfUnwatched(): Promise<void> {
    if (this.liveSocketCount() > 0) return
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS)
  }

  /** True for `local-*` rooms opened by the offline test mode. */
  private isLocalTestRoom(gameId: string): boolean {
    return (
      this.env.ENVIRONMENT !== 'production' &&
      this.env.ALLOW_DEV_BYPASS === '1' &&
      gameId.startsWith('local-')
    )
  }

  private async isNativeLobbyMember(gameId: string, playerId: string): Promise<boolean> {
    try {
      const id = this.env.LOBBY_ROOM.idFromName(gameId)
      const stub = this.env.LOBBY_ROOM.get(id)
      const url = new URL('https://lobby.internal/internal/membership')
      url.searchParams.set('lobbyId', gameId)
      url.searchParams.set('playerId', playerId)
      const response = await stub.fetch(new Request(url.toString()))
      if (!response.ok) return false
      const body = await response.json() as { member?: boolean }
      return body.member === true
    } catch {
      return false
    }
  }

  /** Read access check shared by the WS join and the HTTP state route. */
  private async canReadGame(playerId: string): Promise<boolean> {
    const gameId = this.resolveGameId()
    if (this.devMode || this.isLocalTestRoom(gameId)) return true
    return this.isNativeLobbyMember(gameId, playerId)
  }

  private async getNativeGameState(gameId: string): Promise<Record<string, unknown> | null> {
    try {
      const id = this.env.LOBBY_ROOM.idFromName(gameId)
      const stub = this.env.LOBBY_ROOM.get(id)
      const url = new URL('https://lobby.internal/internal/game-state')
      url.searchParams.set('lobbyId', gameId)
      const response = await stub.fetch(new Request(url.toString()))
      if (!response.ok) return null
      return await response.json() as Record<string, unknown>
    } catch {
      return null
    }
  }

  /**
   * Load (or reload) the in-memory game. Sources, in order:
   *   1. This room's own SQLite snapshot (normal case after eviction).
   *   2. The lobby DO's seed, written when the host started the game.
   *
   * Race fix (PERFORMANCE_AUDIT_WORKERS K1):
   *   Два параллельных join'а раньше могли оба читать источник. Теперь
   *   `blockConcurrencyWhile` атомарно проверяет+загружает state.
   */
  private async loadGame(): Promise<void> {
    if (this.currentGame) return
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.currentGame) return
      const gameId = this.resolveGameId()
      const stored = await this.ctx.storage.get(STORAGE_KEY_GAME) as
        | Record<string, unknown>
        | undefined
      const raw = stored ?? (await this.getNativeGameState(gameId))
      if (!raw) {
        throw new Error(`Игра ${gameId} не найдена`)
      }
      // Enrich zone metadata with the bundled card catalog. This is the
      // catalog -> Worker link used by the mechanics runtime.
      let hydrated = raw
      let cardCatalog: Record<string, CardCatalogEntry> = {}
      try {
        const [lands, cards] = [getLands(), getCardIndex()]
        const landTypes = new Map<string, string>()
        for (const land of lands) {
          const row = land as { id?: unknown; land_type?: unknown }
          const id = String(row.id ?? '')
          const type = String(row.land_type ?? '')
          if (id && type) landTypes.set(id, type)
        }
        cardCatalog = Object.fromEntries(cards) as Record<string, CardCatalogEntry>
        const players = Array.isArray(raw.players)
          ? (raw.players as Array<Record<string, unknown>>)
          : []
        hydrated = {
          ...raw,
          players: players.map((player) => ({
            ...player,
            zones: Array.isArray(player.zones)
              ? (player.zones as unknown[]).map((zone) => {
                  const row = zone as Record<string, unknown>
                  const landId = row.land_id == null ? '' : String(row.land_id)
                  return {
                    ...row,
                    land_type: row.land_type ?? landTypes.get(landId) ?? null,
                  }
                })
              : [],
          })),
        }
      } catch (error) {
        console.error('[GameRoom] catalog hydration failed', error)
        // Mechanics are authoritative, but a broken catalog must be visible.
        cardCatalog = {}
      }
      // eslint-disable-next-line react-hooks/immutability -- DO mutation must happen inside the critical section
      this.currentGame = rawToGameState(hydrated, cardCatalog)
      // eslint-disable-next line react-hooks/immutability -- counter reset, not React state
      this.actionsSinceSnapshot = 0
      // Бот-места заполняются колодой до первого broadcast'а, чтобы клиент
      // при первой загрузке видел земли и карты бота.
      if (await this.ensureBotSeats()) await this.publishCurrentState()
    })
  }

  /**
   * Dev-only: build (or extend) an in-memory game so the sync path can be
   * exercised without a lobby. The first joining client seeds the game;
   * a second distinct clientId is added as player 2 and the game flips to
   * `active`. Decks come from the bundled catalog (same builder the bot uses),
   * so the local test room shows real cards and real art.
   */
  private async ensureDevGame(clientId: string): Promise<void> {
    if (!this.currentGame) {
      this.currentGame = {
        id: this.resolveGameId(),
        status: 'setup',
        current_turn: 0,
        current_player_id: null,
        version: 1,
        started_at: null,
        ended_at: null,
        turn_started_at: null,
        game_state: {},
        players: [],
      }
    }
    if (!this.currentGame.players.some((p) => p.player_id === clientId)) {
      this.currentGame.players.push(emptyPlayer(clientId, this.currentGame.players.length + 1, clientId))
    }
    // Local test rooms include a deterministic opponent so one browser can
    // exercise the complete turn loop without a second participant.
    if (this.currentGame.players.length === 1 && !this.currentGame.players.some((p) => p.is_bot)) {
      this.currentGame.players.push(fillSeatWithCatalogDeck(makeBotSeat(2)))
    }
    // eslint-disable-next-line react-hooks/immutability -- DO mutation, not React state
    this.currentGame = {
      ...this.currentGame,
      players: this.currentGame.players.map((player) =>
        needsDeck(player) ? fillSeatWithCatalogDeck(player) : player,
      ),
    }
    if (this.currentGame.players.length >= 2 && this.currentGame.status === 'setup') {
      this.currentGame.status = 'active'
      this.currentGame.current_turn = 1
      this.currentGame.current_player_id = this.currentGame.players[0].player_id
      this.currentGame.started_at = new Date().toISOString()
      this.currentGame.turn_started_at = this.currentGame.started_at
    }
  }

  /**
   * Persist the in-memory game into this room's SQLite storage.
   *
   * Sessions are transient — no Supabase, no lobby round-trip. The snapshot is
   * written after every action so a DO restart does not lose progress; the
   * alarm drops the whole session once the room has been empty for ROOM_TTL_MS.
   */
  private async persistSnapshot(): Promise<void> {
    if (!this.currentGame) return
    const snapshot = serializeGameState(this.currentGame)
    await this.ctx.storage.put(STORAGE_KEY_GAME, snapshot)
    this.actionsSinceSnapshot = 0
    await this.armCleanupIfUnwatched()
  }

  /**
   * Apply an action via the in-memory engine. After mutation:
   *   1. Save the new state to the in-memory cache.
   *   2. Push a personalized snapshot to every connected viewer.
   *   3. Persist the session snapshot when due.
   */
  private async handleAction(
    ws: WebSocket,
    action: string,
    payload: Record<string, unknown>,
    actorId: string,
    requestId?: string,
  ): Promise<void> {
    if (!this.currentGame) {
      throw new Error('Game not loaded — join first')
    }
    if (!KNOWN_ACTIONS.has(action as GameActionName)) {
      throw new Error(`Unknown action: ${action}`)
    }

    const requestKey = requestId ? `${actorId}:${requestId}` : null
    if (requestKey && this.processedRequests.has(requestKey)) {
      // The client already received the result; replay the current state for
      // reconnect/idempotency safety without applying the action twice.
      await this.sendStateTo(ws, actorId, requestId)
      return
    }

    const engineAction = payloadToEngineAction(action as GameActionName, payload)
    const result = applyAction(this.currentGame, engineAction, actorId)

    if (isEngineError(result)) {
      throw new Error(result.error)
    }

    const applyResult = result as ApplyResult
    this.currentGame = applyResult.state
    this.actionsSinceSnapshot += 1
    if (requestKey) {
      this.processedRequests.add(requestKey)
      while (this.processedRequests.size > 512) {
        const oldest = this.processedRequests.values().next().value
        if (!oldest) break
        this.processedRequests.delete(oldest)
      }
    }

    await this.broadcastPersonalizedStates(applyResult, requestId)

    if (
      this.actionsSinceSnapshot >= SNAPSHOT_EVERY_N_ACTIONS ||
      action === 'end_turn' ||
      applyResult.gameFinished === true
    ) {
      try {
        await this.persistSnapshot()
      } catch (err) {
        console.error('[GameRoom] persistSnapshot failed:', err)
        // Snapshots are best-effort; the in-memory state stays valid.
      }
    }
  }

  private async sendStateTo(ws: WebSocket, clientId: string, requestId?: string): Promise<void> {
    if (!this.currentGame) return
    const game = buildBroadcastState(this.currentGame, clientId)
    const version = Number(game.version ?? 0)
    const playersArr = Array.isArray(game.players) ? game.players : []
    const visibility = playersArr.map((p: any) => ({
      id: p?.player_id,
      isSelf: p?.player_id === clientId,
      handLen: Array.isArray(p?.hand) ? p.hand.length : -1,
      hand_count: p?.hand_count ?? -1,
      zoneCount: Array.isArray(p?.zones) ? p.zones.length : 0,
      zoneCards: Array.isArray(p?.zones)
        ? (p.zones as any[]).reduce((sum, z) => sum + (Array.isArray(z?.cards) ? z.cards.length : 0), 0)
        : 0,
    }))
    console.log('[GameRoom] sendStateTo', { clientId, version, requestId, players: visibility })
    this.safeSend(ws, serverMsg({ type: 'state', version, game, requestId }))
  }

  /**
   * Broadcast personalized snapshots to every connected viewer.
   *
   * Что улучшено (PERFORMANCE_AUDIT_WORKERS K7):
   *   `state` и `battle_events` объединены в ОДИН payload на каждого
   *   клиента — раньше было 2 ws.send() × N клиентов = 2N sends на action.
   *   Теперь N sends. На 4 живых игроков — 4 вместо 8.
   *
   * ServerMessage расширен: `{ type: 'state_with_battle', state, battleEvents, ... }`.
   * Клиент (см. useGameWsHandler) парсит оба поля из одного фрейма.
   */
  private async broadcastPersonalizedStates(
    applyResult: ApplyResult,
    requestId?: string,
  ): Promise<void> {
    const liveSockets: { ws: WebSocket; clientId: string }[] = []
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== 1) continue
      const session = this.getSession(ws)
      if (session?.clientId) liveSockets.push({ ws, clientId: session.clientId })
    }
    await Promise.all(
      liveSockets.map(({ ws, clientId }) => {
        if (!this.currentGame) return Promise.resolve()
        const game = buildBroadcastState(this.currentGame, clientId)
        const version = Number(game.version ?? 0)
        const hasBattle = applyResult.battleEvents && applyResult.battleEvents.length > 0
        if (hasBattle) {
          // Один payload: state + battle events вместе.
          const payload = serverMsg({
            type: 'state_with_battle',
            version,
            game,
            events: applyResult.battleEvents ?? [],
            gameFinished: applyResult.gameFinished === true,
            winnerId: applyResult.winnerId ?? null,
            requestId,
          })
          this.safeSend(ws, payload)
        } else {
          const payload = serverMsg({ type: 'state', version, game, requestId })
          this.safeSend(ws, payload)
        }
        return Promise.resolve()
      }),
    )
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
}

/* -------------------------------------------------------------------- *
 * Conversions: stored JSON shape ↔ Engine GameState                    *
 * -------------------------------------------------------------------- */

/** Coerce an arbitrary JSON value into the engine's expected shape. */
function asInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Serialize the session for SQLite. `catalog` is intentionally dropped: the
 * bundled catalog is re-attached on every load, and persisting 500+ rows per
 * action would bloat storage for nothing.
 */
function serializeGameState(game: GameState): Record<string, unknown> {
  return {
    id: game.id,
    lobby_id: game.lobby_id ?? null,
    status: game.status,
    current_turn: game.current_turn,
    current_player_id: game.current_player_id,
    winner_id: game.winner_id ?? null,
    game_state: game.game_state ?? {},
    version: game.version,
    started_at: game.started_at ?? null,
    ended_at: game.ended_at ?? null,
    turn_started_at: game.turn_started_at ?? null,
    players: game.players.map((p) => ({
      player_id: p.player_id,
      nickname: p.nickname ?? null,
      position: p.position ?? null,
      health: p.health,
      player_order: p.player_order,
      hand: p.hand,
      deck_pile: p.deck_pile,
      deck_remaining: p.deck_remaining,
      discard_pile: p.discard_pile,
      actions_remaining: p.actions_remaining,
      free_draw_used: p.free_draw_used,
      paid_draw_used: p.paid_draw_used,
      cost_reduction: p.cost_reduction ?? 0,
      free_play_next: p.free_play_next ?? false,
      is_bot: p.is_bot ?? false,
      zones: p.zones,
    })),
  }
}

/* -------------------------------------------------------------------- *
 * Seats                                                                *
 * -------------------------------------------------------------------- */

/** A seat with no cards — decks are filled from the catalog afterwards. */
function emptyPlayer(playerId: string, order: number, nickname?: string): PlayerState {
  return {
    player_id: playerId,
    nickname: nickname ?? playerId,
    position: null,
    health: 25,
    player_order: order,
    hand: [],
    deck_pile: [],
    deck_remaining: 0,
    discard_pile: [],
    actions_remaining: 2,
    free_draw_used: false,
    paid_draw_used: false,
    zones: [1, 2, 3, 4].map((z) => ({ zone_position: z, cards: [], land_id: null })),
  }
}

/** Bot seat. The id is random so a client cannot claim the bot's identity. */
function makeBotSeat(order: number): PlayerState {
  return {
    ...emptyPlayer(`bot-${crypto.randomUUID().slice(0, 8)}`, order, BOT_NICKNAME),
    is_bot: true,
  }
}

function rawZone(raw: unknown): { zone_position: number; cards: any[]; land_id?: string | null; land_type?: string | null; frozen?: boolean; flipped?: boolean } {
  const obj = raw && typeof raw === 'object' ? (raw as any) : {}
  return {
    zone_position: asInt(obj.zone_position, 0),
    cards: asArray(obj.cards),
    land_id: obj.land_id ?? null,
    land_type: obj.land_type ?? null,
    frozen: obj.frozen === true,
    flipped: obj.flipped === true,
  }
}

function rawPlayer(raw: unknown): PlayerState {
  const obj = raw && typeof raw === 'object' ? (raw as any) : {}
  const hand = asArray<unknown>(obj.hand)
  const deck = asArray<unknown>(obj.deck_pile)
  const discard = asArray<unknown>(obj.discard_pile)
  const zones = asArray<unknown>(obj.zones).map(rawZone)
  return {
    player_id: asString(obj.player_id, ''),
    nickname: asStringOrNull(obj.nickname),
    position: asStringOrNull(obj.position),
    health: asInt(obj.health, 25),
    player_order: asInt(obj.player_order, 1),
    hand: hand as PlayerState['hand'],
    deck_pile: deck as PlayerState['deck_pile'],
    deck_remaining: asInt(obj.deck_remaining, deck.length),
    discard_pile: discard as PlayerState['discard_pile'],
    actions_remaining: asInt(obj.actions_remaining, 2),
    free_draw_used: asBool(obj.free_draw_used, false),
    paid_draw_used: asBool(obj.paid_draw_used, false),
    cost_reduction: asInt(obj.cost_reduction, 0),
    free_play_next: asBool(obj.free_play_next, false),
    is_bot: obj.is_bot === true,
    zones: zones as PlayerState['zones'],
  }
}

function rawToGameState(
  raw: Record<string, unknown>,
  catalog: Record<string, CardCatalogEntry> = {},
): GameState {
  const players = asArray(raw.players).map(rawPlayer)
  return {
    id: asString(raw.id, ''),
    lobby_id: asStringOrNull(raw.lobby_id) ?? undefined,
    status: (raw.status as GameState['status']) ?? 'active',
    current_turn: asInt(raw.current_turn, 0),
    current_player_id: asStringOrNull(raw.current_player_id),
    winner_id: asStringOrNull(raw.winner_id),
    game_state: (raw.game_state as Record<string, unknown> | undefined) ?? {},
    version: asInt(raw.version, 1),
    started_at: asStringOrNull(raw.started_at),
    ended_at: asStringOrNull(raw.ended_at),
    turn_started_at: asStringOrNull(raw.turn_started_at),
    players,
    catalog,
  }
}

function payloadToEngineAction(
  action: GameActionName,
  payload: Record<string, unknown>,
): Action {
  switch (action) {
    case 'play_card':
      return {
        type: 'play_card',
        cardIndex: asInt(payload.cardIndex ?? payload.p_card_index, 0),
        zonePosition: asInt(payload.zonePosition ?? payload.p_zone_position, 1),
        slotType: asStringOrNull(payload.slotType ?? payload.p_slot_type),
        targetCardIds: asArray<string>(payload.targetCardIds ?? payload.p_target_card_ids),
      }
    case 'attack':
      return {
        type: 'attack',
        fromZone: asInt(payload.fromZone ?? payload.p_from_zone, 1),
        attackerCardId: asString(payload.attackerCardId ?? payload.p_attacker_card_id, ''),
        toPlayerId: asString(payload.toPlayerId ?? payload.p_to_player_id, ''),
        toZone: asInt(payload.toZone ?? payload.p_to_zone, 1),
      }
    case 'flip_card':
      return {
        type: 'flip_card',
        zonePosition: asInt(payload.zonePosition ?? payload.p_zone_position, 1),
        cardId: asString(payload.cardId ?? payload.p_card_id, ''),
      }
    case 'use_ability':
      return {
        type: 'use_ability',
        zonePosition: asInt(payload.zonePosition ?? payload.p_zone_position, 1),
        cardId: asString(payload.cardId ?? payload.p_card_id, ''),
        mechanicIndex: asInt(payload.mechanicIndex ?? payload.p_mechanic_index, 0),
        targetCardIds: asArray<string>(payload.targetCardIds ?? payload.p_target_card_ids),
      }
    case 'draw_free':
      return { type: 'draw_free' }
    case 'draw_paid':
      return { type: 'draw_paid' }
    case 'shuffle_deck':
      return { type: 'shuffle_deck' }
    case 'discard_from_hand':
      return {
        type: 'discard_from_hand',
        cardIndex: asInt(payload.cardIndex ?? payload.p_card_index, 0),
      }
    case 'discard_from_zone':
      return {
        type: 'discard_from_zone',
        zonePosition: asInt(payload.zonePosition ?? payload.p_zone_position, 1),
        cardId: asString(payload.cardId ?? payload.p_card_id, ''),
      }
    case 'end_turn':
      return { type: 'end_turn' }
    case 'forfeit':
      return { type: 'forfeit' }
    case 'reorder_lands':
      return {
        type: 'reorder_lands',
        landIds: asArray<string>(payload.landIds ?? payload.p_land_ids ?? []),
      }
    case 'confirm_land_setup':
      return {
        type: 'confirm_land_setup',
        bypass: Boolean(payload.bypass),
      }
  }
  // KNOWN_ACTIONS set guards against ever reaching this line at runtime;
  // but TypeScript still needs the function to return.
  throw new Error(`Unknown action: ${action}`)
}
