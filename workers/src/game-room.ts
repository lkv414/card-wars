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
import { applyAction, isError as isEngineError } from './game-engine/engine'
import type {
  Action,
  ApplyResult,
  GameState,
  PlayerState,
} from './game-engine/types.js'
import { buildBroadcastState } from './state-broadcast.js'

interface SessionMeta {
  clientId: string
}

/**
 * Action names accepted by the engine. Anything else returns an
 * unknown-action error to the client.
 */
const KNOWN_ACTIONS = new Set<GameActionName>([
  'play_card',
  'attack',
  'flip_card',
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
 * Worker tries to push every N actions so a Durable Object restart
 * doesn't lose more than N actions of progress.
 */
const SNAPSHOT_EVERY_N_ACTIONS = 5

export class GameRoom extends DurableObject<Env> {
  /** game UUID — also available via ctx.id.name after hibernation */
  gameId = ''

  /** In-memory authoritative state. `null` until first loadGame() call. */
  private currentGame: GameState | null = null

  /** Number of mutations since the last persisted snapshot. */
  private actionsSinceSnapshot = 0

  /** Per-player join status — maps clientId → true. Cleared on close. */
  private joined = new Set<string>()

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
        await this.loadGame()
        this.joined.add(clientId)
        ws.serializeAttachment({ clientId } satisfies SessionMeta)
        ws.send(
          serverMsg({
            type: 'joined',
            roomId: gameId,
            clientId,
            requestId: msg.requestId,
          }),
        )
        await this.sendStateTo(ws, clientId, msg.requestId)
        this.broadcastPresence()
        return
      }

      if (msg.type === 'action') {
        if (!session?.clientId) {
          throw new Error('Send join before action')
        }
        // DO may have been evicted (idle timeout) between join and action.
        // Without a rehydrate, handleAction would throw 'Game not loaded'
        // and the actor gets an error — silently failing for the other
        // connected clients. Hydrate eagerly so every action runs against
        // a known-authoritative state.
        if (!this.currentGame) {
          try {
            await this.loadGame()
            // Catch the actor up to where the rest of the room already is.
            await this.sendStateTo(ws, session.clientId)
          } catch (e) {
            console.error('[GameRoom] rehydrate before action failed:', e)
            throw new Error('Game not loaded and rehydrate failed')
          }
        }
        await this.handleAction(msg.action as GameActionName, msg.payload ?? {}, session.clientId, msg.requestId)
        return
      }

      ws.send(
        serverMsg({
          type: 'error',
          code: 'unknown_type',
          message: `Unknown message type`,
          requestId: msg.requestId,
        }),
      )
    } catch (err) {
      ws.send(
        serverMsg({
          type: 'error',
          code: 'action_failed',
          message: err instanceof Error ? err.message : String(err),
          requestId: msg.requestId,
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
    if (data?.clientId) return data
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

  /**
   * Load (or reload) the in-memory game from Supabase.
   * Called on the first join of the session.
   */
  private async loadGame(): Promise<void> {
    if (this.currentGame) return
    const gameId = this.resolveGameId()
    const raw = await getFullGameState(this.env, gameId)
    if (!raw) {
      throw new Error(`Game ${gameId} not found or get_full_game_state RPC missing`)
    }
    this.currentGame = rawToGameState(raw)
    this.actionsSinceSnapshot = 0
  }

  /**
   * Persist the in-memory game back to Supabase.
   * Called periodically after SNAPSHOT_EVERY_N_ACTIONS mutations.
   */
  private async persistSnapshot(): Promise<void> {
    if (!this.currentGame) return
    // Serialize via the same per-viewer broadcast helper? No — we want
    // the full state. buildBroadcastState redacts, so re-implement the
    // shape here (saving is rare and snapshots aren't the hot path).
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
    const { saveFullGameState } = await import('./supabase.js')
    await saveFullGameState(this.env, game.id, payload)
    this.actionsSinceSnapshot = 0
  }

  /**
   * Apply an action via the in-memory engine. After mutation:
   *   1. Save the new state to the in-memory cache.
   *   2. Push a personalized snapshot to every connected viewer.
   *   3. If we've accumulated enough mutations, persist a snapshot.
   */
  private async handleAction(
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

    const engineAction = payloadToEngineAction(action as GameActionName, payload)
    const result = applyAction(this.currentGame, engineAction, actorId)

    if (isEngineError(result)) {
      throw new Error(result.error)
    }

    const applyResult = result as ApplyResult
    this.currentGame = applyResult.state
    this.actionsSinceSnapshot += 1

    await this.broadcastPersonalizedStates(applyResult, requestId)

    if (
      this.actionsSinceSnapshot >= SNAPSHOT_EVERY_N_ACTIONS ||
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
   * Unlike the legacy path that called `get_player_game_state` RPC twice,
   * this now serves from the in-memory engine — no Supabase round-trip.
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
        const payload = serverMsg({ type: 'state', version, game, requestId })
        this.safeSend(ws, payload)
        // Also notify about battle events via the same broadcast so
        // clients can drive lane-by-lane animations.
        if (applyResult.battleEvents && applyResult.battleEvents.length > 0) {
          this.safeSend(
            ws,
            serverMsg({
              type: 'battle_events',
              events: applyResult.battleEvents,
              gameFinished: applyResult.gameFinished === true,
              winnerId: applyResult.winnerId ?? null,
              requestId,
            }),
          )
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

function rawZone(raw: unknown): { zone_position: number; cards: any[]; land_id?: string | null } {
  const obj = raw && typeof raw === 'object' ? (raw as any) : {}
  return {
    zone_position: asInt(obj.zone_position, 0),
    cards: asArray(obj.cards),
    land_id: obj.land_id ?? null,
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
    zones: zones as PlayerState['zones'],
  }
}

function rawToGameState(raw: Record<string, unknown>): GameState {
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