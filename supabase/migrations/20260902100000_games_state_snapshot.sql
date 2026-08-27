-- games.state — single-column authoritative snapshot of the in-memory
-- GameState held by the Worker Durable Object.
--
-- Background: the Worker's game-engine (workers/src/game-engine/) is now
-- the runtime authority. It mutates state in memory, broadcasts
-- personalized snapshots to clients via WebSocket, and periodically
-- pushes the full state back to Supabase via `saveFullGameState`.
--
-- This migration adds a single `state JSONB` column on `games` for that
-- snapshot. The legacy normalized tables (`game_players`, `game_zones`)
-- stay in place as a backup until we're confident the Worker path is
-- stable in production. A follow-up migration will drop them.
--
-- The shape mirrors `get_full_game_state` (which already exists):
--   {
--     id, lobby_id, status, current_turn, current_player_id,
--     winner_id, game_state, version, started_at, ended_at,
--     turn_started_at,
--     players: [{ player_id, nickname, position, health, player_order,
--                 hand, deck_pile, deck_remaining, discard_pile,
--                 actions_remaining, free_draw_used, paid_draw_used,
--                 zones: [{ zone_position, cards, land_id }] }]
--   }

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS state JSONB;

COMMENT ON COLUMN public.games.state IS
  'Full authoritative game snapshot written by the Worker game-room. '
  'Mirrors get_full_game_state() output. The normalized columns '
  '(current_turn, current_player_id, status, version, ...) are kept '
  'for backward compat and admin queries; the worker prefers reading '
  'state via get_full_game_state().';

-- Index for fast lookups by state->'status' (e.g. enumerate active games).
CREATE INDEX IF NOT EXISTS games_state_gin
  ON public.games
  USING GIN (state jsonb_path_ops);

NOTIFY pgrst, 'reload schema';