-- Server-side deck validation at game start.

CREATE OR REPLACE FUNCTION public.validate_lobby_deck(p_deck jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_card_count int;
  v_land_count int;
  elem jsonb;
  card_id text;
  qty int;
  counts jsonb := '{}'::jsonb;
BEGIN
  IF p_deck IS NULL THEN
    RAISE EXCEPTION 'Колода не задана';
  END IF;

  IF jsonb_typeof(p_deck->'cards') <> 'array'
     OR jsonb_array_length(p_deck->'cards') < 1 THEN
    RAISE EXCEPTION 'В колоде должна быть хотя бы 1 карта';
  END IF;

  v_card_count := coalesce(
    (p_deck->>'cardCount')::int,
    jsonb_array_length(p_deck->'cards')
  );
  IF v_card_count > 40 THEN
    RAISE EXCEPTION 'В колоде больше 40 карт (%)', v_card_count;
  END IF;

  v_land_count := coalesce(
    (p_deck->>'landCount')::int,
    jsonb_array_length(coalesce(p_deck->'lands', '[]'::jsonb))
  );
  IF v_land_count > 4 THEN
    RAISE EXCEPTION 'В колоде больше 4 земель (%)', v_land_count;
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(p_deck->'cards') LOOP
    card_id := coalesce(elem->>'id', elem->>'card_id');
    IF card_id IS NOT NULL THEN
      qty := coalesce((counts->>card_id)::int, 0) + 1;
      counts := jsonb_set(counts, ARRAY[card_id], to_jsonb(qty));
      IF qty > 3 THEN
        RAISE EXCEPTION 'Карта % встречается более 3 раз', card_id;
      END IF;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_lobby_deck(jsonb) TO anon, authenticated;

-- Patch start_game_for_lobby: validate each player's deck before ordering.
CREATE OR REPLACE FUNCTION public.start_game_for_lobby(p_guest_id text, p_lobby_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_game_id uuid;
  v_host_id text;
  v_players public.lobby_players%ROWTYPE[];
  v_player public.lobby_players%ROWTYPE;
  v_ordered public.lobby_players%ROWTYPE[] := '{}';
  v_rest public.lobby_players%ROWTYPE[] := '{}';
  v_first_player_id text;
  v_idx int;
  v_hand jsonb;
  v_deck_pile jsonb;
  v_deck_remaining int;
  v_lands jsonb;
  v_land jsonb;
  v_z int;
  v_log jsonb := '[]'::jsonb;
  v_card_count int;
  v_player_count int;
BEGIN
  SELECT host_id INTO v_host_id FROM public.lobbies WHERE id = p_lobby_id;
  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'Лобби не найдено';
  END IF;
  IF v_host_id <> p_guest_id THEN
    RAISE EXCEPTION 'Только хост может начать игру';
  END IF;

  SELECT array_agg(lp ORDER BY lp.joined_at) INTO v_players
  FROM public.lobby_players lp WHERE lp.lobby_id = p_lobby_id;

  IF v_players IS NULL OR array_length(v_players, 1) < 2 THEN
    RAISE EXCEPTION 'Нужно минимум 2 игрока';
  END IF;

  v_player_count := array_length(v_players, 1);
  IF v_player_count > 4 THEN
    RAISE EXCEPTION 'Максимум 4 игрока';
  END IF;

  FOREACH v_player IN ARRAY v_players LOOP
    BEGIN
      PERFORM public.validate_lobby_deck(v_player.deck);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Нет колоды у: % — %', coalesce(v_player.nickname, v_player.player_id), SQLERRM;
    END;
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

  v_log := v_log || jsonb_build_array(jsonb_build_object(
    'timestamp', (extract(epoch from now()) * 1000)::bigint,
    'message', 'Расставьте земли — игра начнётся, когда все будут готовы'
  ));

  INSERT INTO public.games (
    lobby_id, status, current_turn, current_player_id, game_state, version, started_at
  ) VALUES (
    p_lobby_id, 'setup', 0, NULL,
    jsonb_build_object(
      'status', 'setup',
      'currentPlayerId', null,
      'currentTurn', 0,
      'turnPhase', 'setup',
      'firstPlayerId', v_first_player_id,
      'log', v_log
    ),
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
      deck_remaining, position, player_order, land_setup_ready
    ) VALUES (
      v_game_id,
      v_player.player_id,
      coalesce(v_player.nickname, 'Игрок ' || v_idx),
      25,
      v_hand,
      v_deck_pile,
      v_deck_remaining,
      'player' || v_idx,
      v_idx,
      false
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

  UPDATE public.lobbies SET status = 'in_game' WHERE id = p_lobby_id;
  RETURN v_game_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_game_for_lobby(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_game_for_lobby(text, uuid) TO anon, authenticated;
