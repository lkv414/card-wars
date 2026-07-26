-- Fix game_players.position to match the live constraint.
-- Live constraint accepts only player1/player2 for the current 2-player game.
-- The RPC keeps player_order numeric and stores position as player1/player2.

CREATE OR REPLACE FUNCTION public.start_game_for_lobby(
  p_guest_id text,
  p_lobby_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lobby public.lobbies;
  v_players public.lobby_players[];
  v_player public.lobby_players;
  v_ordered public.lobby_players[] := '{}';
  v_rest public.lobby_players[] := '{}';
  v_game_id uuid;
  v_existing_id uuid;
  v_first_player_id text;
  v_idx int := 0;
  v_hand jsonb;
  v_deck_pile jsonb;
  v_deck_remaining int;
  v_lands jsonb;
  v_land jsonb;
  v_z int;
  v_card_count int;
  v_initial_state jsonb;
  v_log jsonb := '[]'::jsonb;
BEGIN
  IF p_guest_id IS NULL OR length(trim(p_guest_id)) < 16 THEN
    RAISE EXCEPTION 'Некорректный guest_id';
  END IF;
  PERFORM set_config('app.guest_id', p_guest_id, true);

  SELECT * INTO v_lobby FROM public.lobbies WHERE id = p_lobby_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Лобби не найдено'; END IF;
  IF v_lobby.host_id <> p_guest_id THEN RAISE EXCEPTION 'Только хост может начать игру'; END IF;

  SELECT id INTO v_existing_id FROM public.games WHERE lobby_id = p_lobby_id LIMIT 1;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  SELECT array_agg(lp ORDER BY lp.joined_at) INTO v_players
  FROM public.lobby_players lp WHERE lp.lobby_id = p_lobby_id;
  IF v_players IS NULL OR array_length(v_players, 1) < 2 THEN
    RAISE EXCEPTION 'Нужно минимум 2 игрока';
  END IF;

  FOREACH v_player IN ARRAY v_players LOOP
    IF v_player.deck IS NULL OR jsonb_typeof(v_player.deck->'cards') <> 'array'
       OR jsonb_array_length(v_player.deck->'cards') < 1 THEN
      RAISE EXCEPTION 'Нет колоды у: %', coalesce(v_player.nickname, v_player.player_id);
    END IF;
    IF v_player.player_id = p_guest_id THEN
      v_ordered := array_append(v_ordered, v_player);
    ELSE
      v_rest := array_append(v_rest, v_player);
    END IF;
  END LOOP;
  v_ordered := v_ordered || v_rest;
  v_first_player_id := v_ordered[1].player_id;

  FOREACH v_player IN ARRAY v_ordered LOOP
    v_card_count := coalesce((v_player.deck->>'cardCount')::int, jsonb_array_length(v_player.deck->'cards'));
    v_log := v_log || jsonb_build_array(jsonb_build_object(
      'timestamp', (extract(epoch from now()) * 1000)::bigint,
      'message', coalesce(v_player.nickname, 'Игрок') || ' · колода «' ||
        coalesce(v_player.deck->>'name', '—') || '» (' || v_card_count || ' карт)'
    ));
  END LOOP;

  v_initial_state := jsonb_build_object(
    'status', 'active', 'currentTurn', 0,
    'currentPlayerId', v_first_player_id, 'turnPhase', 'draw', 'log', v_log
  );

  INSERT INTO public.games (
    lobby_id, status, current_turn, current_player_id, game_state, version, started_at
  ) VALUES (
    p_lobby_id, 'setup', 0, NULL,
    jsonb_build_object('status', 'setup', 'currentPlayerId', null, 'currentTurn', 0, 'turnPhase', 'draw', 'log', v_log),
    1, now()
  ) RETURNING id INTO v_game_id;

  v_idx := 0;
  FOREACH v_player IN ARRAY v_ordered LOOP
    v_idx := v_idx + 1;

    SELECT coalesce(jsonb_agg(c), '[]'::jsonb) INTO v_hand
    FROM (
      SELECT c FROM jsonb_array_elements(v_player.deck->'cards') WITH ORDINALITY AS t(c, ord)
      ORDER BY random() LIMIT 5
    ) sub;

    SELECT coalesce(jsonb_agg(c), '[]'::jsonb) INTO v_deck_pile
    FROM (
      SELECT c FROM jsonb_array_elements(v_player.deck->'cards') WITH ORDINALITY AS t(c, ord)
      ORDER BY random() OFFSET 5
    ) sub;

    v_deck_remaining := jsonb_array_length(v_deck_pile);
    v_lands := coalesce(v_player.deck->'lands', '[]'::jsonb);

    INSERT INTO public.game_players (
      game_id, player_id, nickname, health, hand, deck_pile,
      deck_remaining, position, player_order
    ) VALUES (
      v_game_id,
      v_player.player_id,
      coalesce(v_player.nickname, 'Игрок ' || v_idx),
      25,
      v_hand,
      v_deck_pile,
      v_deck_remaining,
      'player' || v_idx,
      v_idx
    );

    FOR v_z IN 1..4 LOOP
      v_land := v_lands->(v_z - 1);
      INSERT INTO public.game_zones (game_id, player_id, zone_position, cards, land_id)
      VALUES (
        v_game_id,
        v_player.player_id,
        v_z,
        '[]'::jsonb,
        CASE
          WHEN v_land IS NOT NULL AND v_land->>'id' IS NOT NULL
            THEN (v_land->>'id')::uuid
          ELSE NULL
        END
      );
    END LOOP;
  END LOOP;

  UPDATE public.games
  SET status = 'active',
      current_player_id = v_first_player_id,
      game_state = v_initial_state,
      version = 2
  WHERE id = v_game_id AND version = 1;

  UPDATE public.lobbies SET status = 'in_game' WHERE id = p_lobby_id;
  RETURN v_game_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_game_for_lobby(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_game_for_lobby(text, uuid) TO anon, authenticated;
