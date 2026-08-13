-- Ably Postgres Database Connector — outbox pattern (stage 1).
-- Docs: https://ably.com/docs/livesync/postgres

CREATE TABLE IF NOT EXISTS public.ably_nodes (
  id TEXT PRIMARY KEY,
  expiry TIMESTAMP WITHOUT TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ably_outbox (
  sequence_id  SERIAL PRIMARY KEY,
  mutation_id  TEXT NOT NULL,
  channel      TEXT NOT NULL,
  name         TEXT NOT NULL,
  rejected     BOOLEAN NOT NULL DEFAULT false,
  data         JSONB,
  headers      JSONB,
  locked_by    TEXT,
  lock_expiry  TIMESTAMP WITHOUT TIME ZONE,
  processed    BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ably_outbox_channel_seq_idx
  ON public.ably_outbox (channel, sequence_id);

CREATE OR REPLACE FUNCTION public.ably_outbox_notify()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('ably_adbc'::text, ''::text);
  RETURN NULL;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'ably_outbox_notify: %', SQLERRM;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ably_outbox_insert_notify ON public.ably_outbox;
CREATE TRIGGER ably_outbox_insert_notify
AFTER INSERT ON public.ably_outbox
FOR EACH STATEMENT
EXECUTE PROCEDURE public.ably_outbox_notify();

-- Low-level enqueue used by RPC helpers.
CREATE OR REPLACE FUNCTION public.ably_enqueue(
  p_channel TEXT,
  p_event_name TEXT,
  p_data JSONB,
  p_mutation_id TEXT DEFAULT gen_random_uuid()::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_channel IS NULL OR p_event_name IS NULL OR p_data IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.ably_outbox (mutation_id, channel, name, data)
  VALUES (COALESCE(NULLIF(p_mutation_id, ''), gen_random_uuid()::text), p_channel, p_event_name, p_data);
END;
$$;

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
  IF p_game_id IS NULL OR p_data IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.ably_enqueue(
    'game:' || p_game_id::text,
    'sync',
    p_data,
    COALESCE(p_mutation_id, gen_random_uuid()::text)
  );
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
  IF p_lobby_id IS NULL OR p_data IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.ably_enqueue(
    'lobby:' || p_lobby_id::text,
    'update',
    p_data,
    COALESCE(p_mutation_id, gen_random_uuid()::text)
  );
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
DECLARE
  v_players JSONB;
BEGIN
  SELECT COALESCE(
    jsonb_agg(to_jsonb(lp) ORDER BY lp.joined_at),
    '[]'::jsonb
  )
  INTO v_players
  FROM public.lobby_players lp
  WHERE lp.lobby_id = p_lobby_id;

  PERFORM public.ably_enqueue_lobby_sync(
    p_lobby_id,
    jsonb_build_object(
      'type', 'players',
      'actorId', p_actor_id,
      'players', v_players
    )
  );
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
  PERFORM public.ably_enqueue_game_sync(
    p_game_id,
    jsonb_build_object(
      'type', 'reload',
      'version', p_version,
      'actorId', p_actor_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ably_enqueue(TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ably_enqueue_game_sync(UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ably_enqueue_lobby_sync(UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ably_publish_lobby_players(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ably_publish_game_reload(UUID, TEXT, INT) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ably_outbox TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ably_nodes TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ably_outbox_sequence_id_seq TO service_role;

COMMENT ON TABLE public.ably_outbox IS
  'Ably Postgres connector outbox — configure Integration Rule with outboxTableName=ably_outbox, nodesTableName=ably_nodes';
