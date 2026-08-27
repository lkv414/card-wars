/**
 * Pure helpers used across the engine. No I/O, no Date.now, no Math.random.
 */

import type { Card, GameState, PlayerState, Zone } from './types'

/** Returns a new state with `version` bumped and `turn_started_at` refreshed. */
export function bumpVersion(
  state: GameState,
  extra: Partial<Pick<GameState, 'game_state' | 'status' | 'ended_at' | 'winner_id'>> = {},
): GameState {
  return {
    ...state,
    version: (state.version ?? 0) + 1,
    turn_started_at: new Date().toISOString(),
    ...extra,
  }
}

/** Returns the player whose turn it is, or null if the game is not active. */
export function getActivePlayer(state: GameState): PlayerState | null {
  if (!state.current_player_id) return null
  return state.players.find((p) => p.player_id === state.current_player_id) ?? null
}

/** Returns a specific player by id. */
export function getPlayer(state: GameState, playerId: string): PlayerState | null {
  return state.players.find((p) => p.player_id === playerId) ?? null
}

/** Returns alive (health > 0) players in `player_order` order. */
export function getAlivePlayers(state: GameState): PlayerState[] {
  return state.players
    .filter((p) => (p.health ?? 0) > 0)
    .slice()
    .sort((a, b) => (a.player_order ?? 0) - (b.player_order ?? 0))
}

/** Returns the zone object for (player, zone_position 1..4). */
export function getZone(player: PlayerState, zonePosition: number): Zone | null {
  return player.zones.find((z) => z.zone_position === zonePosition) ?? null
}

/**
 * Reshuffle discard into deck if deck is empty. Returns the new deck and discard.
 * Caller is responsible for not calling this when both are empty.
 */
export function reshuffleIfNeeded(deck: Card[], discard: Card[]): {
  deck: Card[]
  discard: Card[]
} {
  if (deck.length > 0) return { deck, discard }
  if (discard.length === 0) return { deck, discard }
  return { deck: [...discard], discard: [] }
}

/**
 * Draw one card from the top of the deck (last element). Caller is
 * responsible for checking deck/discard emptiness first.
 */
export function drawTopCard(deck: Card[]): { drawn: Card; newDeck: Card[] } {
  if (deck.length === 0) throw new Error('drawTopCard called on empty deck')
  const drawn = deck[deck.length - 1]
  return { drawn, newDeck: deck.slice(0, -1) }
}

/**
 * Refill `hand` from the top of `deck` until it has `limit` cards.
 * Stops early when deck runs out.
 */
export function refillHand(
  hand: Card[],
  deck: Card[],
  limit: number,
): { hand: Card[]; deck: Card[]; drew: number } {
  let h = hand
  let d = deck
  let drew = 0
  while (h.length < limit && d.length > 0) {
    h = [...h, d[d.length - 1]]
    d = d.slice(0, -1)
    drew += 1
  }
  return { hand: h, deck: d, drew }
}

/** Random-shuffle (Fisher-Yates) — engine doesn't use RNG by default,
 * but the legacy `shuffle_deck` RPC exposed it for client-driven UX. */
export function shuffleDeck(deck: Card[], rng: () => number = Math.random): Card[] {
  const out = [...deck]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/** Push a card to the discard pile. */
export function pushDiscard(discard: Card[], card: Card): Card[] {
  return [...discard, card]
}

/** Remove a card from the discard pile by instanceId (or id). */
export function removeFromDiscard(discard: Card[], predicate: (c: Card) => boolean): Card[] {
  const idx = discard.findIndex(predicate)
  if (idx === -1) return discard
  return [...discard.slice(0, idx), ...discard.slice(idx + 1)]
}

/** Make the engine deterministic in tests by fixing the rng seed. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    // Mulberry32 — small, fast, good enough for shuffle tests.
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}