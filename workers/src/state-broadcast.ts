/**
 * buildBroadcastState — port of the legacy `get_player_game_state` SQL
 * function (see DB_SCHEMA.sql). Runs entirely in-memory from the engine's
 * `GameState`, with per-client "fog of war" applied (other players'
 * hands/deck_pile are hidden, only counts are exposed).
 *
 * The shape mirrors what the client already expects in `getPlayerGameState`,
 * so `gameStore.applyServerState` keeps working without any frontend
 * changes.
 */

import type { GameState, PlayerState } from './game-engine/types.js'

/** Fields a non-self viewer should NOT see for other players. */
function redactForViewer(player: PlayerState): PlayerState {
  return {
    ...player,
    // Hide the actual cards from observers; keep counters only.
    hand: [],
    deck_pile: [],
    is_self: false,
  }
}

function revealForViewer(player: PlayerState): PlayerState {
  return {
    ...player,
    is_self: true,
  }
}

/**
 * Build the broadcast payload for a single client.
 *
 * Output shape mirrors `get_player_game_state` (DB_SCHEMA.sql):
 *   {
 *     id, lobby_id, status, current_turn, current_player_id, winner_id,
 *     game_state, version, started_at, ended_at,
 *     players: [{ id, player_id, nickname, position, health, player_order,
 *                 is_self, hand, deck_pile, deck_remaining, hand_count,
 *                 deck_pile_count, zones: [{zone_position, cards, land_id}] }]
 *   }
 *
 * `hand_count` and `deck_pile_count` are convenience fields added on
 * top of the engine's `PlayerState` shape so the existing frontend
 * selectors (gameStore.applyServerState) keep working unchanged.
 */
export function buildBroadcastState(
  game: GameState,
  viewerId: string,
): Record<string, unknown> {
  const players = game.players.map((p) => {
    const isSelf = p.player_id === viewerId
    const base = isSelf ? revealForViewer(p) : redactForViewer(p)
    // Counts are computed from the ORIGINAL state, not the redacted
    // hand/deck_pile (which is empty for non-self viewers). Otherwise
    // observers would see hand_count=0 even though the opponent has cards.
    const handCount = Array.isArray(p.hand) ? p.hand.length : 0
    const deckCount = Array.isArray(p.deck_pile) ? p.deck_pile.length : 0
    return {
      ...base,
      hand_count: handCount,
      deck_pile_count: deckCount,
    }
  })
  return {
    id: game.id,
    lobby_id: game.lobby_id,
    status: game.status,
    current_turn: game.current_turn,
    current_player_id: game.current_player_id,
    winner_id: game.winner_id,
    game_state: game.game_state ?? {},
    version: game.version ?? 0,
    started_at: game.started_at,
    ended_at: game.ended_at,
    players,
  }
}