-- Фаза расстановки земель: игра остаётся в setup, пока все игроки не подтвердят порядок.

ALTER TABLE public.game_players
  ADD COLUMN IF NOT EXISTS land_setup_ready boolean NOT NULL DEFAULT false;

-- start_game_for_lobby: не переводить сразу в active
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
$$;

-- Перестановка земель игрока (4 uuid в порядке слотов 1..4)
CREATE OR REPLACE FUNCTION public.reorder_player_lands(
  p_game_id uuid,
  p_player_id text,
  p_land_ids uuid[]
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_lobby_id uuid;
  i int;
BEGIN
  IF array_length(p_land_ids, 1) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Нужно ровно 4 земли';
  END IF;

  SELECT g.lobby_id INTO v_lobby_id FROM public.games g WHERE g.id = p_game_id;
  IF v_lobby_id IS NULL THEN
    RAISE EXCEPTION 'Игра не найдена';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lobby_players lp
    WHERE lp.lobby_id = v_lobby_id AND lp.player_id = p_player_id
  ) THEN
    RAISE EXCEPTION 'Доступ запрещён';
  END IF;

  IF (SELECT status FROM public.games WHERE id = p_game_id) <> 'setup' THEN
    RAISE EXCEPTION 'Расстановка уже завершена';
  END IF;

  IF EXISTS (SELECT 1 FROM public.game_players WHERE game_id = p_game_id AND player_id = p_player_id AND land_setup_ready) THEN
    RAISE EXCEPTION 'Вы уже подтвердили расстановку';
  END IF;

  FOR i IN 1..4 LOOP
    UPDATE public.game_zones
    SET land_id = p_land_ids[i]
    WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = i;
  END LOOP;
END;
$$;

-- Подтверждение расстановки; при готовности всех — старт матча
CREATE OR REPLACE FUNCTION public.confirm_land_setup(p_game_id uuid, p_player_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_lobby_id uuid;
  v_first_player_id text;
  v_log jsonb;
  v_ready int;
  v_total int;
BEGIN
  SELECT g.lobby_id, g.game_state->'log', g.game_state->>'firstPlayerId'
  INTO v_lobby_id, v_log, v_first_player_id
  FROM public.games g WHERE g.id = p_game_id;

  IF v_lobby_id IS NULL THEN
    RAISE EXCEPTION 'Игра не найдена';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lobby_players lp
    WHERE lp.lobby_id = v_lobby_id AND lp.player_id = p_player_id
  ) THEN
    RAISE EXCEPTION 'Доступ запрещён';
  END IF;

  IF (SELECT status FROM public.games WHERE id = p_game_id) <> 'setup' THEN
    RETURN;
  END IF;

  UPDATE public.game_players
  SET land_setup_ready = true
  WHERE game_id = p_game_id AND player_id = p_player_id;

  SELECT count(*) FILTER (WHERE land_setup_ready), count(*)
  INTO v_ready, v_total
  FROM public.game_players WHERE game_id = p_game_id;

  IF v_ready < v_total THEN
    RETURN;
  END IF;

  v_log := coalesce(v_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'timestamp', (extract(epoch from now()) * 1000)::bigint,
    'message', 'Все игроки расставили земли — игра началась!'
  ));

  UPDATE public.games
  SET
    status = 'active',
    current_player_id = v_first_player_id,
    game_state = jsonb_build_object(
      'status', 'active',
      'currentTurn', 0,
      'currentPlayerId', v_first_player_id,
      'turnPhase', 'draw',
      'log', v_log
    ),
    version = version + 1
  WHERE id = p_game_id;
END;
$$;

-- get_player_game_state: land_type + land_setup_ready
CREATE OR REPLACE FUNCTION public.get_player_game_state(p_game_id uuid, p_player_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  result jsonb;
  lobby_uuid uuid;
BEGIN
  SELECT g.lobby_id INTO lobby_uuid FROM public.games g WHERE g.id = p_game_id;
  IF lobby_uuid IS NULL THEN RETURN NULL; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lobby_players lp
    WHERE lp.lobby_id = lobby_uuid AND lp.player_id = p_player_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id', g.id,
    'lobby_id', g.lobby_id,
    'status', g.status,
    'current_turn', g.current_turn,
    'current_player_id', g.current_player_id,
    'winner_id', g.winner_id,
    'game_state', g.game_state,
    'version', g.version,
    'started_at', g.started_at,
    'ended_at', g.ended_at,
    'players', (
      SELECT coalesce(jsonb_agg(player_obj ORDER BY (player_obj->>'player_order')::int), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'id', gp.player_id,
          'player_id', gp.player_id,
          'nickname', gp.nickname,
          'position', gp.position,
          'health', gp.health,
          'player_order', gp.player_order,
          'land_setup_ready', gp.land_setup_ready,
          'is_self', gp.player_id = p_player_id,
          'hand', CASE WHEN gp.player_id = p_player_id THEN gp.hand ELSE '[]'::jsonb END,
          'deck_pile', CASE WHEN gp.player_id = p_player_id THEN gp.deck_pile ELSE '[]'::jsonb END,
          'deck_remaining', gp.deck_remaining,
          'hand_count', jsonb_array_length(gp.hand),
          'deck_pile_count', jsonb_array_length(gp.deck_pile),
          'zones', (
            SELECT coalesce(jsonb_agg(zobj ORDER BY (zobj->>'zone_position')::int), '[]'::jsonb)
            FROM (
              SELECT jsonb_build_object(
                'zone_position', gz.zone_position,
                'cards', gz.cards,
                'land_id', gz.land_id,
                'land_type', l.land_type,
                'land_name', l.name
              ) AS zobj
              FROM public.game_zones gz
              LEFT JOIN public.lands l ON l.id = gz.land_id
              WHERE gz.game_id = gp.game_id AND gz.player_id = gp.player_id
            ) z
          )
        ) AS player_obj
        FROM public.game_players gp
        WHERE gp.game_id = g.id
      ) players_subq
    )
  ) INTO result
  FROM public.games g
  WHERE g.id = p_game_id;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_player_lands(uuid, text, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_land_setup(uuid, text) TO anon, authenticated;
