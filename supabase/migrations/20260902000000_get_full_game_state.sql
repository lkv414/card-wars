-- get_full_game_state — full (unredacted) snapshot for the Worker GameRoom.
--
-- Background: the Worker's `game-engine/` now owns the authoritative game
-- state at runtime. To boot the in-memory state when a Durable Object
-- wakes from hibernation (or on first join), the Worker calls
-- `get_full_game_state` once and caches the result. Unlike
-- `get_player_game_state`, this RPC returns ALL players' hands and
-- deck_piles intact — only the Worker's broadcast layer applies the
-- fog-of-war redaction per viewer.
--
-- This migration adds the new RPC without touching existing ones, so
-- the worker can adopt it incrementally. The legacy `get_player_game_state`
-- stays in place for the lobby admin scripts that still use it.

CREATE OR REPLACE FUNCTION public.get_full_game_state(p_game_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', g.id,
    'lobby_id', g.lobby_id,
    'status', g.status,
    'current_turn', COALESCE(g.current_turn, 0),
    'current_player_id', g.current_player_id,
    'winner_id', g.winner_id,
    'game_state', COALESCE(g.game_state, '{}'::jsonb),
    'version', COALESCE(g.version, 1),
    'started_at', g.started_at,
    'ended_at', g.ended_at,
    'turn_started_at', g.turn_started_at,
    'players', (
      SELECT COALESCE(jsonb_agg(player_obj), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'player_id', gp.player_id,
          'nickname', gp.nickname,
          'position', gp.position,
          'health', COALESCE(gp.health, 25),
          'player_order', COALESCE(gp.player_order, 1),
          'hand', COALESCE(gp.hand, '[]'::jsonb),
          'deck_pile', COALESCE(gp.deck_pile, '[]'::jsonb),
          'deck_remaining', COALESCE(gp.deck_remaining, jsonb_array_length(COALESCE(gp.deck_pile, '[]'::jsonb))),
          'discard_pile', COALESCE(gp.discard_pile, '[]'::jsonb),
          'actions_remaining', COALESCE(gp.actions_remaining, 2),
          'free_draw_used', COALESCE(gp.free_draw_used, false),
          'paid_draw_used', COALESCE(gp.paid_draw_used, false),
          'zones', (
            SELECT COALESCE(jsonb_agg(zobj), '[]'::jsonb)
            FROM (
              SELECT jsonb_build_object(
                'zone_position', gz.zone_position,
                'cards', COALESCE(gz.cards, '[]'::jsonb),
                'land_id', gz.land_id
              ) AS zobj
              FROM public.game_zones gz
              WHERE gz.game_id = gp.game_id AND gz.player_id = gp.player_id
              ORDER BY gz.zone_position
            ) z
          )
        ) AS player_obj
        FROM public.game_players gp
        WHERE gp.game_id = g.id
        ORDER BY gp.player_order
      ) players_subq
    )
  ) INTO result
  FROM public.games g
  WHERE g.id = p_game_id;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_full_game_state(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';