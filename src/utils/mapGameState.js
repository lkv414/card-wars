/**
 * Map get_player_game_state RPC payload → client game object (GameScreen shape).
 */
export function mapRpcGameState(state) {
  if (!state) return null
  return {
    id: state.id,
    lobby_id: state.lobby_id,
    status: state.status,
    current_turn: state.current_turn,
    current_player_id: state.current_player_id,
    winner_id: state.winner_id,
    game_state: state.game_state,
    actions_remaining: state.actions_remaining,
    version: state.version,
    started_at: state.started_at,
    ended_at: state.ended_at,
    players: (state.players || []).map((p) => ({
      ...p,
      actions_remaining: p.actions_remaining ?? 2,
      free_draw_used: p.free_draw_used ?? false,
      paid_draw_used: p.paid_draw_used ?? false,
      zones: Array.isArray(p.zones)
        ? p.zones
            .sort((a, b) => a.zone_position - b.zone_position)
            .map((z) => ({
              zone_position: z.zone_position,
              cards: z.cards || [],
              land_id: z.land_id ?? null,
              land_type: z.land_type ?? null,
              land_name: z.land_name ?? null,
            }))
        : [],
    })),
  }
}

/** @param {unknown} lobbyRow */
export function mapLobbyPlayers(lobbyRow) {
  const players = lobbyRow?.lobby_players
  if (Array.isArray(players)) return players
  return null
}

export function lobbyStatus(lobbyRow) {
  return lobbyRow?.status ?? null
}
