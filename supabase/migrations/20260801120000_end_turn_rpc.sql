-- ============================================================
-- end_turn / forfeit as SECURITY DEFINER RPCs
-- Fixes:
--  1) RLS blocks updating the NEXT player's hand on endTurn
--  2) SET LOCAL app.guest_id only lasts one request → mutations
--     often run without guest_id → 0-row updates look like version conflict
--  3) Race between game_players update and games.version optimistic lock
-- ============================================================

CREATE OR REPLACE FUNCTION public.end_turn(p_guest_id text, p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.games%ROWTYPE;
  players text[];
  cur_idx int;
  next_id text;
  next_hand jsonb;
  next_pile jsonb;
  drew boolean := false;
  new_log jsonb;
  new_version int;
  nick text;
BEGIN
  IF p_guest_id IS NULL OR length(trim(p_guest_id)) = 0 THEN
    RETURN jsonb_build_object('error', 'guest_id обязателен');
  END IF;

  PERFORM set_config('app.guest_id', p_guest_id, true);

  SELECT * INTO g FROM public.games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игра не найдена');
  END IF;

  IF g.status = 'finished' THEN
    RETURN jsonb_build_object('error', 'Игра уже завершена');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lobby_players lp
    WHERE lp.lobby_id = g.lobby_id AND lp.player_id = p_guest_id
  ) THEN
    RETURN jsonb_build_object('error', 'Нет доступа к игре');
  END IF;

  IF g.current_player_id IS DISTINCT FROM p_guest_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  SELECT array_agg(gp.player_id ORDER BY gp.player_order)
  INTO players
  FROM public.game_players gp
  WHERE gp.game_id = p_game_id AND COALESCE(gp.health, 0) > 0;

  IF players IS NULL OR array_length(players, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'Нет живых игроков');
  END IF;

  cur_idx := array_position(players, g.current_player_id);
  IF cur_idx IS NULL THEN
    next_id := players[1];
  ELSE
    next_id := players[1 + (cur_idx % array_length(players, 1))];
  END IF;

  SELECT hand, deck_pile, nickname INTO next_hand, next_pile, nick
  FROM public.game_players
  WHERE game_id = p_game_id AND player_id = next_id
  FOR UPDATE;

  next_hand := COALESCE(next_hand, '[]'::jsonb);
  next_pile := COALESCE(next_pile, '[]'::jsonb);

  IF jsonb_typeof(next_pile) = 'array' AND jsonb_array_length(next_pile) > 0 THEN
    next_hand := next_hand || jsonb_build_array(next_pile -> (jsonb_array_length(next_pile) - 1));
    next_pile := next_pile - (jsonb_array_length(next_pile) - 1);
    drew := true;

    UPDATE public.game_players
    SET
      hand = next_hand,
      deck_pile = next_pile,
      deck_remaining = jsonb_array_length(next_pile),
      updated_at = now()
    WHERE game_id = p_game_id AND player_id = next_id;
  END IF;

  new_log := COALESCE(g.game_state->'log', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'timestamp', (extract(epoch from now()) * 1000)::bigint,
      'message', CASE
        WHEN drew THEN format('Ход переходит к %s · добрал 1 карту', COALESCE(nick, 'следующему'))
        ELSE format('Ход переходит к %s · колода пуста', COALESCE(nick, 'следующему'))
      END
    )
  );

  new_version := COALESCE(g.version, 1) + 1;

  UPDATE public.games
  SET
    current_player_id = next_id,
    current_turn = COALESCE(g.current_turn, 0) + 1,
    game_state = COALESCE(g.game_state, '{}'::jsonb) || jsonb_build_object('log', new_log),
    version = new_version,
    updated_at = now(),
    turn_started_at = now()
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', true,
    'version', new_version,
    'current_player_id', next_id,
    'drew', drew
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.forfeit_game(p_guest_id text, p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.games%ROWTYPE;
  remaining text[];
  winner text;
  next_id text;
  players_ord text[];
  my_idx int;
  i int;
  cand text;
  new_log jsonb;
  new_version int;
BEGIN
  IF p_guest_id IS NULL OR length(trim(p_guest_id)) = 0 THEN
    RETURN jsonb_build_object('error', 'guest_id обязателен');
  END IF;

  PERFORM set_config('app.guest_id', p_guest_id, true);

  SELECT * INTO g FROM public.games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игра не найдена');
  END IF;

  IF g.status = 'finished' THEN
    RETURN jsonb_build_object('error', 'Игра уже завершена');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lobby_players lp
    WHERE lp.lobby_id = g.lobby_id AND lp.player_id = p_guest_id
  ) THEN
    RETURN jsonb_build_object('error', 'Нет доступа к игре');
  END IF;

  IF g.current_player_id IS DISTINCT FROM p_guest_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  UPDATE public.game_players
  SET health = 0, updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_guest_id;

  SELECT array_agg(gp.player_id ORDER BY gp.player_order)
  INTO remaining
  FROM public.game_players gp
  WHERE gp.game_id = p_game_id
    AND gp.player_id <> p_guest_id
    AND COALESCE(gp.health, 0) > 0;

  new_log := COALESCE(g.game_state->'log', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'timestamp', (extract(epoch from now()) * 1000)::bigint,
      'message', format('Игрок сдался. Осталось в игре: %s.', COALESCE(array_length(remaining, 1), 0))
    )
  );

  new_version := COALESCE(g.version, 1) + 1;

  IF remaining IS NULL OR COALESCE(array_length(remaining, 1), 0) <= 1 THEN
    winner := CASE WHEN remaining IS NOT NULL AND array_length(remaining, 1) = 1 THEN remaining[1] ELSE NULL END;
    UPDATE public.games
    SET
      status = 'finished',
      winner_id = winner,
      current_player_id = COALESCE(winner, p_guest_id),
      game_state = COALESCE(g.game_state, '{}'::jsonb) || jsonb_build_object('log', new_log),
      version = new_version,
      ended_at = now(),
      updated_at = now()
    WHERE id = p_game_id;

    RETURN jsonb_build_object('success', true, 'finished', true, 'winner_id', winner, 'version', new_version);
  END IF;

  SELECT array_agg(gp.player_id ORDER BY gp.player_order)
  INTO players_ord
  FROM public.game_players gp
  WHERE gp.game_id = p_game_id;

  my_idx := array_position(players_ord, p_guest_id);
  next_id := remaining[1];
  IF my_idx IS NOT NULL AND players_ord IS NOT NULL THEN
    FOR i IN 1..array_length(players_ord, 1) LOOP
      cand := players_ord[1 + ((my_idx - 1 + i) % array_length(players_ord, 1))];
      IF cand = ANY (remaining) THEN
        next_id := cand;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.games
  SET
    current_player_id = next_id,
    current_turn = COALESCE(g.current_turn, 0) + 1,
    game_state = COALESCE(g.game_state, '{}'::jsonb) || jsonb_build_object('log', new_log),
    version = new_version,
    updated_at = now(),
    turn_started_at = now()
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', true,
    'finished', false,
    'current_player_id', next_id,
    'version', new_version
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_turn(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_game(text, uuid) TO anon, authenticated;
