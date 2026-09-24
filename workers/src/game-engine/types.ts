/**
 * Game-engine type contracts.
 *
 * These are the canonical shapes the Worker holds in memory and broadcasts
 * to clients. They mirror the JSON shape returned by the legacy
 * `get_player_game_state` SQL function (see supabase/DB_SCHEMA.sql), but
 * live as a denormalized single object instead of three normalized tables
 * — the Worker is the single source of truth at runtime, and only the
 * periodic snapshot pushes the state to Supabase.
 *
 * Every action is a pure function `(state, payload) -> { state, error? }`.
 * No I/O, no time, no randomness — that keeps the engine unit-testable
 * with no Worker / DB / network involved.
 */

/** Card instance as it lives inside a hand, deck, zone, or discard. */
export interface Card {
  /** Stable blueprint id from the catalog (e.g. "PL_F_001"). */
  id: string
  /** Per-instance id, used as React/Three.js key. */
  instanceId?: string
  card_type?: 'creature' | 'building' | 'spell'
  name?: string
  image_url?: string
  attack?: number
  health?: number
  defense?: number
  cost?: number
  /** True field — deployed creature already attacked this turn. */
  tapped?: boolean
  /** True field — creature was flipped face-down. */
  flipped?: boolean
  /** Legacy alias from old SQL; treat same as `flipped`. */
  isFlipped?: boolean
  /** True field — id of the zone (1..4) this card was played to. */
  zone_position?: number
  /** True field — "creature" | "building" depending on where it can sit. */
  slot_type?: 'creature' | 'building'
  /** Free-form catalog payload, passed through verbatim. */
  [extra: string]: unknown
}

/** A single zone slot on a player's board (4 slots in the current rules). */
export interface Zone {
  /** True field — 1..4 lane id. */
  zone_position: number
  /** Cards currently in this slot (creatures, buildings). */
  cards: Card[]
  /** Optional land_id binding this slot to a landscape type. */
  land_id?: string | null
  /** Landscape type of the bound land (corn/ice/good/swamp/sand/blue/any). */
  land_type?: string | null
}

/** Per-player runtime state. */
export interface PlayerState {
  player_id: string
  nickname?: string | null
  position?: string | null
  /** True field — current HP; game ends at 0. */
  health: number
  /** True field — turn order (1..N). */
  player_order: number
  /** True field — only meaningful for the viewer; observers see []. */
  hand: Card[]
  /** True field — only meaningful for the viewer. */
  deck_pile: Card[]
  /** True field — cache for UI (avoids re-counting deck_pile). */
  deck_remaining: number
  /** True field — discard pile; reshuffled into deck when deck empties. */
  discard_pile: Card[]
  /** True field — actions left in current turn (resets to 2 on end_turn). */
  actions_remaining: number
  /** True field — true if the free draw was already used this turn. */
  free_draw_used: boolean
  /** True field — true if the paid draw was already used this turn. */
  paid_draw_used: boolean
  /** Temporary cost reduction granted by an active card ability. */
  cost_reduction?: number
  /** The next playable card is free due to a resolved ability. */
  free_play_next?: boolean
  /** 4 board slots. */
  zones: Zone[]
  /** Convenience flag — only the active viewer has is_self=true. */
  is_self?: boolean
}

/** Subset of card fields the engine reads without needing the catalog. */
export interface CardCatalogEntry {
  id: string
  card_type?: Card['card_type']
  cost?: number
  /** If defined, engine treats the card as a "building" (one per slot). */
  slot_type?: 'creature' | 'building'
  /** Structured runtime mechanics loaded from Supabase -> KV. */
  mechanics?: unknown
  mechanics_version?: number
  mechanics_status?: 'unreviewed' | 'text_only' | 'implemented' | 'disabled'
  [extra: string]: unknown
}

/** Top-level state held inside the Durable Object. */
export interface GameState {
  id: string
  lobby_id?: string
  status: 'setup' | 'active' | 'finished' | 'abandoned'
  current_turn: number
  current_player_id: string | null
  winner_id?: string | null
  version: number
  started_at?: string | null
  ended_at?: string | null
  turn_started_at?: string | null
  game_state?: Record<string, unknown>
  /** Source-of-truth roster. */
  players: PlayerState[]
  /** Subset of cards the engine cares about (cost, slot_type). */
  catalog?: Record<string, CardCatalogEntry>
}

/** Snapshot returned by `applyAction` when it mutates state. */
export interface ApplyResult {
  state: GameState
  /** Battle phase produces extra metadata for the broadcast payload. */
  battleEvents?: BattleEvent[]
  gameFinished?: boolean
  winnerId?: string | null
  /** Optional log line appended to game_state.log. */
  logEntry?: string | null
}

/** One lane fight, used by `end_turn` to drive animations. */
export interface BattleEvent {
  attacker_id: string
  attacker_card_id: string
  attacker_instance_id: string
  from_zone: number
  defender_id: string
  to_zone: number
  damage: number
  face_damage: number
  counter_damage: number
  attacker_killed: boolean
  attacker_damaged: boolean
  creature_killed: boolean
  creature_damaged: boolean
}

/** Engine-side error envelope — same shape RPC used to return. */
export interface EngineError {
  error: string
}

/** Tagged union of all client actions. Mirrors `GAME_ACTION_RPC` in protocol.ts. */
export type Action =
  | { type: 'play_card'; cardIndex: number; zonePosition: number; slotType?: string | null; targetCardIds?: string[] }
  | { type: 'attack'; fromZone: number; attackerCardId: string; toPlayerId: string; toZone: number }
  | { type: 'flip_card'; zonePosition: number; cardId: string }
  | {
      type: 'use_ability'
      zonePosition: number
      cardId: string
      mechanicIndex: number
      targetCardIds?: string[]
    }
  | { type: 'draw_free' }
  | { type: 'draw_paid' }
  | { type: 'shuffle_deck' }
  | { type: 'discard_from_hand'; cardIndex: number }
  | { type: 'discard_from_zone'; zonePosition: number; cardId: string }
  | { type: 'end_turn' }
  | { type: 'forfeit' }
  | { type: 'reorder_lands'; landIds: string[] }
  | { type: 'confirm_land_setup'; bypass?: boolean }

export type ActionName = Action['type']

/** Convenience guard: an ApplyResult is "ok" when it has no `error` field. */
export function isEngineError(value: ApplyResult | EngineError): value is EngineError {
  return typeof (value as EngineError).error === 'string'
}