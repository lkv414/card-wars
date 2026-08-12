-- Отдельные слоты существо/строение на земле + сброс (discard_pile)

ALTER TABLE public.game_players
  ADD COLUMN IF NOT EXISTS discard_pile JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Валидация зоны: макс 2 карты (1 существо + 1 строение)
CREATE OR REPLACE FUNCTION public.validate_game_zone_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  elem JSONB;
  creatures INT := 0;
  buildings INT := 0;
BEGIN
  IF NEW.zone_position IS NOT NULL THEN
    IF NEW.zone_position < 1 OR NEW.zone_position > 4 THEN
      RAISE EXCEPTION 'zone_position должен быть в [1..4], получено %', NEW.zone_position
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.cards IS NOT NULL THEN
    IF jsonb_typeof(NEW.cards) <> 'array' THEN
      RAISE EXCEPTION 'cards должен быть JSON-массивом'
        USING ERRCODE = 'datatype_mismatch';
    END IF;

    IF jsonb_array_length(NEW.cards) > 2 THEN
      RAISE EXCEPTION 'На земле не может быть больше 2 карт (существо + строение)'
        USING ERRCODE = 'check_violation';
    END IF;

    FOR elem IN SELECT value FROM jsonb_array_elements(NEW.cards) LOOP
      IF elem->>'card_type' = 'building' THEN
        buildings := buildings + 1;
      ELSE
        creatures := creatures + 1;
      END IF;
    END LOOP;

    IF creatures > 1 THEN
      RAISE EXCEPTION 'На земле может быть только одно существо'
        USING ERRCODE = 'check_violation';
    END IF;

    IF buildings > 1 THEN
      RAISE EXCEPTION 'На земле может быть только одно строение'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- play_card: проверка слота creature/building
DROP FUNCTION IF EXISTS public.play_card(UUID, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.play_card(
  p_game_id UUID,
  p_player_id TEXT,
  p_card_index INT,
  p_zone_position INT,
  p_slot_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player RECORD;
  v_hand JSONB;
  v_deck JSONB;
  v_card JSONB;
  v_card_with_meta JSONB;
  v_new_hand JSONB;
  v_new_deck JSONB;
  v_new_version INT;
  v_target_zone JSONB;
  v_hand_limit INT := 5;
  v_slot TEXT;
  v_card_type TEXT;
  elem JSONB;
  v_has_creature BOOLEAN := FALSE;
  v_has_building BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_player FROM game_players
    WHERE game_id = p_game_id AND player_id = p_player_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игрок не найден');
  END IF;

  v_hand := COALESCE(v_player.hand, '[]'::jsonb);
  v_deck := COALESCE(v_player.deck_pile, '[]'::jsonb);

  IF p_card_index < 0 OR p_card_index >= jsonb_array_length(v_hand) THEN
    RETURN jsonb_build_object('error', 'Неверный индекс карты');
  END IF;

  IF p_zone_position < 1 OR p_zone_position > 4 THEN
    RETURN jsonb_build_object('error', 'Неверная позиция зоны (1-4)');
  END IF;

  v_card := v_hand->p_card_index;
  v_card_type := COALESCE(v_card->>'card_type', 'creature');
  v_slot := COALESCE(p_slot_type, CASE WHEN v_card_type = 'building' THEN 'building' ELSE 'creature' END);

  IF v_slot NOT IN ('creature', 'building') THEN
    RETURN jsonb_build_object('error', 'Неверный тип слота');
  END IF;

  IF v_slot = 'building' AND v_card_type <> 'building' THEN
    RETURN jsonb_build_object('error', 'Строения кладутся только в слот строения');
  END IF;

  IF v_slot = 'creature' AND v_card_type = 'building' THEN
    RETURN jsonb_build_object('error', 'Существа не кладутся в слот строения');
  END IF;

  v_hand := (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
             FROM (
               SELECT value, ordinality
               FROM jsonb_array_elements(v_hand) WITH ORDINALITY
               WHERE ordinality <> p_card_index + 1
             ) sub);

  SELECT COALESCE(cards, '[]'::jsonb) INTO v_target_zone
  FROM game_zones
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position;
  IF v_target_zone IS NULL THEN
    v_target_zone := '[]'::jsonb;
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(v_target_zone) LOOP
    IF elem->>'card_type' = 'building' THEN
      v_has_building := TRUE;
    ELSE
      v_has_creature := TRUE;
    END IF;
  END LOOP;

  IF v_slot = 'creature' AND v_has_creature THEN
    RETURN jsonb_build_object('error', 'Слот существа на этой земле занят');
  END IF;

  IF v_slot = 'building' AND v_has_building THEN
    RETURN jsonb_build_object('error', 'Слот строения на этой земле занят');
  END IF;

  v_card_with_meta := v_card || jsonb_build_object(
    'tapped', false,
    'flipped', false,
    'zone_position', p_zone_position,
    'slot_type', v_slot
  );
  v_target_zone := v_target_zone || jsonb_build_array(v_card_with_meta);

  v_new_hand := v_hand;
  v_new_deck := v_deck;
  WHILE jsonb_array_length(v_new_hand) < v_hand_limit AND jsonb_array_length(v_new_deck) > 0 LOOP
    v_new_hand := v_new_hand || jsonb_build_array(v_new_deck->(jsonb_array_length(v_new_deck) - 1));
    v_new_deck := (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
                   FROM (
                     SELECT value, ordinality
                     FROM jsonb_array_elements(v_new_deck) WITH ORDINALITY
                     WHERE ordinality <> jsonb_array_length(v_new_deck)
                   ) sub);
  END LOOP;

  SELECT version INTO v_new_version FROM games WHERE id = p_game_id FOR UPDATE;
  IF v_new_version IS NULL THEN
    RETURN jsonb_build_object('error', 'Игра не найдена');
  END IF;

  UPDATE game_players SET
    hand = v_new_hand,
    deck_pile = v_new_deck,
    deck_remaining = jsonb_array_length(v_new_deck)
  WHERE game_id = p_game_id AND player_id = p_player_id;

  UPDATE game_zones SET
    cards = v_target_zone,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position;

  UPDATE games SET
    version = v_new_version + 1,
    updated_at = now()
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version + 1,
    'hand_count', jsonb_array_length(v_new_hand),
    'deck_remaining', jsonb_array_length(v_new_deck),
    'card', v_card,
    'slot_type', v_slot
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.play_card(UUID, TEXT, INT, INT, TEXT) TO anon, authenticated;

-- Убрать карту с земли в сброс
CREATE OR REPLACE FUNCTION public.discard_from_zone(
  p_game_id UUID,
  p_player_id TEXT,
  p_zone_position INT,
  p_card_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player RECORD;
  v_zone JSONB;
  v_new_zone JSONB := '[]'::jsonb;
  v_discard JSONB;
  v_removed JSONB;
  v_found BOOLEAN := FALSE;
  elem JSONB;
  v_new_version INT;
BEGIN
  SELECT * INTO v_player FROM game_players
    WHERE game_id = p_game_id AND player_id = p_player_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игрок не найден');
  END IF;

  IF p_zone_position < 1 OR p_zone_position > 4 THEN
    RETURN jsonb_build_object('error', 'Неверная позиция зоны (1-4)');
  END IF;

  SELECT COALESCE(cards, '[]'::jsonb) INTO v_zone
  FROM game_zones
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position
  FOR UPDATE;

  IF v_zone IS NULL THEN
    RETURN jsonb_build_object('error', 'Земля не найдена');
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(v_zone) LOOP
    IF NOT v_found AND (
      elem->>'id' = p_card_id
      OR elem->>'instanceId' = p_card_id
    ) THEN
      v_removed := elem;
      v_found := TRUE;
    ELSE
      v_new_zone := v_new_zone || jsonb_build_array(elem);
    END IF;
  END LOOP;

  IF NOT v_found THEN
    RETURN jsonb_build_object('error', 'Карта не найдена на земле');
  END IF;

  v_discard := COALESCE(v_player.discard_pile, '[]'::jsonb) || jsonb_build_array(v_removed);

  SELECT version INTO v_new_version FROM games WHERE id = p_game_id FOR UPDATE;
  IF v_new_version IS NULL THEN
    RETURN jsonb_build_object('error', 'Игра не найдена');
  END IF;

  UPDATE game_zones SET cards = v_new_zone, updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position;

  UPDATE game_players SET discard_pile = v_discard
  WHERE game_id = p_game_id AND player_id = p_player_id;

  UPDATE games SET version = v_new_version + 1, updated_at = now()
  WHERE id = p_game_id;

  RETURN jsonb_build_object('success', TRUE, 'version', v_new_version + 1, 'card', v_removed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.discard_from_zone(UUID, TEXT, INT, TEXT) TO anon, authenticated;

-- get_player_game_state: discard_pile
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
          'discard_pile', CASE WHEN gp.player_id = p_player_id THEN COALESCE(gp.discard_pile, '[]'::jsonb) ELSE '[]'::jsonb END,
          'deck_remaining', gp.deck_remaining,
          'hand_count', jsonb_array_length(gp.hand),
          'deck_pile_count', jsonb_array_length(gp.deck_pile),
          'discard_count', jsonb_array_length(COALESCE(gp.discard_pile, '[]'::jsonb)),
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
$function$;
