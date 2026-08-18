-- Disable Ably realtime pipeline (Ably integration removed).
--
-- Background: realtime delivery now goes through Cloudflare Worker WebSocket
-- (workers/src/game-room.ts) which broadcasts state directly to connected
-- clients via Durable Object hibernation. The Ably outbox pattern is no
-- longer used and the connector role has no consumer.
--
-- This migration:
--   1. Replaces ably_enqueue_game_sync / ably_publish_game_reload / etc. with
--      no-op stubs so existing RPCs (play_card, end_turn, draw_card, ...)
--      that still call them via PERFORM keep working.
--   2. Removes the INSERT trigger that emits pg_notify to the Ably
--      connector (no listener is registered anyway, but the trigger
--      still incurs per-INSERT cost).
--   3. Drops the ably_connector role (no one connects to it).
--
-- We intentionally KEEP the ably_outbox / ably_nodes tables and the
-- helper functions (ably_enqueue, ably_enqueue_lobby_sync, etc.) so we
-- don't need to rewrite 6+ existing RPCs. They become dead code in the
-- schema. A future cleanup migration can drop them when we have a
-- proper CI to verify nothing calls them.

-- 1) Replace publisher functions with no-op stubs.

CREATE OR REPLACE FUNCTION public.ably_enqueue_game_sync(
  p_game_id UUID,
  p_data JSONB,
  p_mutation_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- no-op: realtime delivery is now handled by Cloudflare Worker.
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.ably_publish_game_reload(
  p_game_id UUID,
  p_actor_id TEXT,
  p_version INT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- no-op
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.ably_enqueue_lobby_sync(
  p_lobby_id UUID,
  p_data JSONB,
  p_mutation_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- no-op
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.ably_publish_lobby_players(
  p_lobby_id UUID,
  p_actor_id TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- no-op
  RETURN;
END;
$$;

-- 2) Drop the NOTIFY trigger — no listener, just cost.
DROP TRIGGER IF EXISTS ably_outbox_insert_notify ON public.ably_outbox;

-- 3) Drop the dedicated Postgres role (no connector connects anymore).
REVOKE ALL ON FUNCTION public.ably_enqueue_game_sync(UUID, JSONB, TEXT) FROM ably_connector;
REVOKE ALL ON FUNCTION public.ably_publish_game_reload(UUID, TEXT, INT) FROM ably_connector;
REVOKE ALL ON TABLE public.ably_outbox FROM ably_connector;
REVOKE ALL ON TABLE public.ably_nodes FROM ably_connector;
REVOKE ALL ON SEQUENCE public.ably_outbox_sequence_id_seq FROM ably_connector;
REVOKE CONNECT ON DATABASE postgres FROM ably_connector;
-- DROP ROLE IF EXISTS ably_connector;  -- left commented: role may be
-- referenced by other grants; safer to revoke than drop.

COMMENT ON FUNCTION public.ably_enqueue_game_sync IS 'DEPRECATED no-op — realtime is delivered via Cloudflare Worker WS (see workers/src/game-room.ts).';
COMMENT ON FUNCTION public.ably_publish_game_reload IS 'DEPRECATED no-op.';

NOTIFY pgrst, 'reload schema';