import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'
import {
  parseClientMessage,
  serverMsg,
  type GameActionName,
} from './protocol'
import {
  assertPlayerInGame,
  getFullGameState,
  getPlayerGameState,
} from './supabase'
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
import { testCard } from './dev-fixtures.js'

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
 * Minimum number of state mutations between persisted snapshots. The
 * Worker pushes a snapshot every N actions so a Durable Object restart
 * doesn't lose more than N actions of progress.
 *
 * Authoritative state is persisted after every action. This is intentionally
 * conservative while the mechanics runtime is being introduced: correctness and
 * restart safety take priority over snapshot batching.
 */
const SNAPSHOT_EVERY_N_ACTIONS = 1

export class GameRoom extends DurableObject<Env> {
  /** game UUID — also available via ctx.id.name after hibernation */
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
   * `x-dev-bypass-auth` handshake flag. When true the room never touches
   * Supabase — it creates an in-memory game so two WS clients can exercise
   * the sync/broadcast path without a database. Never enabled in prod
   * because the bypass header is only honored here, not in assertPlayerInGame
   * callers outside this file.
   */
  private devMode = false
  private nativeGame = false

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
        const localTestRoom =
          this.env.ENVIRONMENT !== 'production' &&
          this.env.ALLOW_DEV_BYPASS === '1' &&
          gameId.startsWith('local-')
        if (!meta.bypassAuth && !localTestRoom) {
          const nativeMember = await this.isNativeLobbyMember(gameId, clientId)
          if (!nativeMember) await assertPlayerInGame(this.env, gameId, clientId)
          await this.loadGame()
        } else {
          // Dev-only: no Supabase. Spin up an in-memory game so we can test
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
        await this.sendStateTo(ws, clientId, requestId)
        this.broadcastPresence()
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
    } catch (err) {
      console.error('[GameRoom] broadcastPresence on close failed:', err)
    }
  }

  async webSocketError(ws: WebSocket, error?: unknown): Promise<void> {
    const session = this.getSession(ws)
    if (session?.clientId) this.joined.delete(session.clientId)
    try {
      this.broadcastPresence()
    } catch (err) {
      console.error('[GameRoom] broadcastPresence on error failed:', err)
    }
    void error
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
   * Load (or reload) the in-memory game from a Worker-native lobby first,
   * then from Supabase for legacy games.
   * Called on the first join of the session.
   *
   * Race fix (PERFORMANCE_AUDIT_WORKERS K1):
   *   Два параллельных join'а раньше могли оба прочитать Supabase. Теперь
   *   `blockConcurrencyWhile` атомарно проверяет+загружает state — только
   *   один RPC пройдёт, остальные дождутся.
   */
  private async loadGame(): Promise<void> {
    if (this.currentGame) return
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.currentGame) return
      const gameId = this.resolveGameId()
      const native = await this.getNativeGameState(gameId)
      this.nativeGame = native !== null
      const raw = native ?? await getFullGameState(this.env, gameId)
      if (!raw) {
        throw new Error(`Game ${gameId} not found or snapshot RPC missing`)
      }
      // Enrich zone metadata and load the authoritative card catalog from KV.
      // This is the DB -> KV -> Worker link used by the mechanics runtime.
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
        // Mechanics are authoritative, but a missing KV catalog must be visible.
        cardCatalog = {}
      }
      // eslint-disable-next-line react-hooks/immutability -- DO mutation must happen inside the critical section
      this.currentGame = rawToGameState(hydrated, cardCatalog)
      // eslint-disable-next-line react-hooks/immutability -- counter reset, not React state
      this.actionsSinceSnapshot = 0
    })
  }

  /**
   * Dev-only: build (or extend) an in-memory game so the sync path can be
   * exercised without Supabase. The first joining client seeds the game;
   * a second distinct clientId is added as player 2 and the game flips to
   * `active`. Each player gets a small hand + deck of placeholder creatures
   * so `play_card` / `end_turn` run through the real engine.
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
      this.currentGame.players.push(makeDevPlayer(clientId, this.currentGame.players.length + 1))
    }
    // Local test rooms include a deterministic opponent so one browser can
    // exercise the complete turn loop without a second participant.
    if (
      this.currentGame.players.length === 1 &&
      !this.currentGame.players.some((p) => p.player_id === 'test-bot')
    ) {
      this.currentGame.players.push(makeDevPlayer('test-bot', 2))
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
   * Persist the in-memory game back to Supabase.
   * Called periodically after SNAPSHOT_EVERY_N_ACTIONS mutations.
   *
   * Race fix (PERFORMANCE_AUDIT_WORKERS K5): под `blockConcurrencyWhile`, чтобы
   * два одновременных snapshot'а (две action'а, попавшие в один тик) не
   * перетёрли друг друга в Supabase. После первого snapshot'а второй
   * обнаружит свежий counter и не пойдёт в сеть.
   */
  private async persistSnapshot(): Promise<void> {
    if (!this.currentGame || this.devMode) return
    await this.ctx.blockConcurrencyWhile(async () => {
      if (!this.currentGame) return
      // Внутри critical section захватываем snapshot текущего state —
      // даже если currentGame изменится во время await (новые action'ы
      // могут прийти во время PATCH), мы persist'им ровно то, что было.
      const game = this.currentGame
      const payload: Record<string, unknown> = {
        state: {
          id: game.id,
          lobby_id: game.lobby_id,
          status: game.status,
          current_turn: game.current_turn,
          current_player_id: game.current_player_id,
          winner_id: game.winner_id,
          game_state: game.game_state ?? {},
          version: game.version,
          started_at: game.started_at,
          ended_at: game.ended_at,
          turn_started_at: game.turn_started_at,
          players: game.players.map((p) => ({
            player_id: p.player_id,
            nickname: p.nickname,
            position: p.position,
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
            zones: p.zones,
          })),
        },
        version: game.version,
        status: game.status,
        winner_id: game.winner_id,
        ended_at: game.ended_at,
        current_player_id: game.current_player_id,
        current_turn: game.current_turn,
      }
      if (this.nativeGame) {
        const targetLobbyId = String(game.lobby_id ?? this.resolveGameId())
        const lobbyId = this.env.LOBBY_ROOM.idFromName(targetLobbyId)
        const lobby = this.env.LOBBY_ROOM.get(lobbyId)
        const response = await lobby.fetch(new Request('https://lobby.internal/internal/game-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }))
        if (!response.ok) throw new Error(`Native snapshot save failed: HTTP ${response.status}`)
        this.actionsSinceSnapshot = 0
        return
      }

      const { saveFullGameState } = await import('./supabase.js')
      await saveFullGameState(this.env, game.id, payload)
      this.actionsSinceSnapshot = 0
    })
  }

  /**
   * Apply an action via the in-memory engine. After mutation:
   *   1. Save the new state to the in-memory cache.
   *   2. Push a personalized snapshot to every connected viewer.
   *   3. If we've accumulated enough mutations, persist a snapshot.
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
 * Conversions: Supabase JSON shape ↔ Engine GameState                  *
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

/* -------------------------------------------------------------------- *
 * Dev-only in-memory game factory (no Supabase)                        *
 * -------------------------------------------------------------------- */

let devCardSeq = 0

function devCard(): Card {
  return testCard(devCardSeq++)
}

function makeDevPlayer(playerId: string, order: number): PlayerState {
  const hand: Card[] = []
  const deck: Card[] = []
  for (let i = 0; i < 20; i++) {
    const c = devCard()
    if (i < 5) hand.push(c)
    else deck.push(c)
  }
  return {
    player_id: playerId,
    nickname: playerId,
    position: null,
    health: 25,
    player_order: order,
    hand,
    deck_pile: deck,
    deck_remaining: deck.length,
    discard_pile: [],
    actions_remaining: 2,
    free_draw_used: false,
    paid_draw_used: false,
    zones: [1, 2, 3, 4].map((z) => ({ zone_position: z, cards: [], land_id: null })),
  }
}

function rawZone(raw: unknown): { zone_position: number; cards: any[]; land_id?: string | null; land_type?: string | null } {
  const obj = raw && typeof raw === 'object' ? (raw as any) : {}
  return {
    zone_position: asInt(obj.zone_position, 0),
    cards: asArray(obj.cards),
    land_id: obj.land_id ?? null,
    land_type: obj.land_type ?? null,
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