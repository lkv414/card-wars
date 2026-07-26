-- Anonymous lobby player mutation for guestId-based RLS.
-- The RPC sets app.guest_id and performs the INSERT/UPDATE in the same
-- PostgREST transaction, so lobby_players policies can see the guest ID.

CREATE OR REPLACE FUNCTION public.upsert_lobby_player(
  p_guest_id text,
  p_lobby_id uuid,
  p_nickname text,
  p_ready boolean DEFAULT false,
  p_deck jsonb DEFAULT NULL
)
RETURNS public.lobby_players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.lobby_players;
  normalized_nickname text;
BEGIN
  IF p_guest_id IS NULL OR length(trim(p_guest_id)) < 16 OR length(p_guest_id) > 128 THEN
    RAISE EXCEPTION 'Некорректный guest_id';
  END IF;

  IF p_lobby_id IS NULL THEN
    RAISE EXCEPTION 'lobby_id обязателен';
  END IF;

  normalized_nickname := left(coalesce(nullif(trim(p_nickname), ''), 'Игрок'), 80);

  PERFORM set_config('app.guest_id', p_guest_id, true);

  IF NOT EXISTS (
    SELECT 1
    FROM public.lobbies
    WHERE id = p_lobby_id
      AND status = 'waiting'
  ) THEN
    RAISE EXCEPTION 'Лобби не найдено или уже закрыто';
  END IF;

  SELECT lp.*
  INTO result
  FROM public.lobby_players lp
  WHERE lp.lobby_id = p_lobby_id
    AND lp.player_id = p_guest_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.lobby_players
    SET nickname = normalized_nickname,
        ready = coalesce(p_ready, false),
        deck = p_deck
    WHERE lobby_id = p_lobby_id
      AND player_id = p_guest_id
    RETURNING * INTO result;
  ELSE
    IF (
      SELECT count(*)
      FROM public.lobby_players
      WHERE lobby_id = p_lobby_id
    ) >= 4 THEN
      RAISE EXCEPTION 'Лобби уже заполнено';
    END IF;

    INSERT INTO public.lobby_players (
      lobby_id,
      player_id,
      nickname,
      ready,
      deck
    )
    VALUES (
      p_lobby_id,
      p_guest_id,
      normalized_nickname,
      coalesce(p_ready, false),
      p_deck
    )
    RETURNING * INTO result;
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_lobby_player(text, uuid, text, boolean, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_lobby_player(text, uuid, text, boolean, jsonb)
  TO anon, authenticated;
