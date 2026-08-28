-- Ably outbox: RPC patches (stage 2 + lobby stage 6)

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
  v_game RECORD;
  v_player RECORD;
  v_hand JSONB;
  v_deck JSONB;
  v_card JSONB;
  v_card_with_meta JSONB;
  v_new_hand JSONB;
  v_new_version INT;
  v_target_zone JSONB;
  v_slot TEXT;
  v_card_type TEXT;
  elem JSONB;
  v_has_creature BOOLEAN := FALSE;
  v_has_building BOOLEAN := FALSE;
  v_actions INT;
  v_cost INT;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Игра не активна');
  END IF;
  IF v_game.current_player_id IS DISTINCT FROM p_player_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  SELECT * INTO v_player FROM game_players
    WHERE game_id = p_game_id AND player_id = p_player_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игрок не найден');
  END IF;

  v_actions := COALESCE(v_player.actions_remaining, 2);
  v_hand := COALESCE(v_player.hand, '[]'::jsonb);
  v_deck := COALESCE(v_player.deck_pile, '[]'::jsonb);

  IF p_card_index < 0 OR p_card_index >= jsonb_array_length(v_hand) THEN
    RETURN jsonb_build_object('error', 'Неверный индекс карты');
  END IF;

  IF p_zone_position < 1 OR p_zone_position > 4 THEN
    RETURN jsonb_build_object('error', 'Неверная позиция зоны (1-4)');
  END IF;

  v_card := v_hand->p_card_index;
  v_cost := public._card_action_cost(v_card);

  IF v_actions < v_cost THEN
    RETURN jsonb_build_object('error', format('Недостаточно действий (нужно %s, осталось %s)', v_cost, v_actions));
  END IF;

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

  v_new_hand := (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
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
    ELSIF COALESCE(elem->>'card_type', 'creature') <> 'spell' THEN
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

  v_new_version := COALESCE(v_game.version, 0) + 1;

  UPDATE game_players SET
    hand = v_new_hand,
    actions_remaining = v_actions - v_cost,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id;

  UPDATE game_zones SET
    cards = v_target_zone,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position;

  UPDATE games SET
    version = v_new_version,
    updated_at = now()
  WHERE id = p_game_id;

  
  PERFORM public.ably_enqueue_game_sync(
    p_game_id,
    jsonb_build_object(
      'type', 'play_card',
      'version', v_new_version,
      'actorId', p_player_id,
      'playerId', p_player_id,
      'cardIndex', p_card_index,
      'zoneIndex', p_zone_position - 1,
      'slotType', v_slot,
      'rpcData', jsonb_build_object(
        'success', TRUE,
        'version', v_new_version,
        'hand_count', jsonb_array_length(v_new_hand),
        'deck_remaining', jsonb_array_length(v_deck),
        'actions_remaining', v_actions - v_cost,
        'action_cost', v_cost,
        'card', v_card,
        'slot_type', v_slot
      ),
      'zoneCards', v_target_zone
    )
  );


  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'hand_count', jsonb_array_length(v_new_hand),
    'deck_remaining', jsonb_array_length(v_deck),
    'actions_remaining', v_actions - v_cost,
    'action_cost', v_cost,
    'card', v_card,
    'slot_type', v_slot
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.draw_free_card(
  p_game_id UUID,
  p_player_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game RECORD;
  v_player RECORD;
  v_hand JSONB;
  v_deck JSONB;
  v_discard JSONB;
  v_new_version INT;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Игра не активна');
  END IF;
  IF v_game.current_player_id IS DISTINCT FROM p_player_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  SELECT * INTO v_player FROM game_players
    WHERE game_id = p_game_id AND player_id = p_player_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игрок не найден');
  END IF;

  IF COALESCE(v_player.free_draw_used, false) THEN
    RETURN jsonb_build_object('error', 'Бесплатный добор уже использован в этом ходу');
  END IF;

  v_hand := COALESCE(v_player.hand, '[]'::jsonb);
  v_deck := COALESCE(v_player.deck_pile, '[]'::jsonb);
  v_discard := COALESCE(v_player.discard_pile, '[]'::jsonb);

  -- Recycle discard into deck if deck empty
  IF jsonb_array_length(v_deck) < 1 AND jsonb_array_length(v_discard) > 0 THEN
    v_deck := v_discard;
    v_discard := '[]'::jsonb;
  END IF;

  IF jsonb_array_length(v_deck) < 1 THEN
    RETURN jsonb_build_object('error', 'Колода и сброс пусты');
  END IF;

  v_hand := v_hand || jsonb_build_array(v_deck -> (jsonb_array_length(v_deck) - 1));
  v_deck := (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
             FROM (
               SELECT value
               FROM jsonb_array_elements(v_deck) WITH ORDINALITY AS t(value, ord)
               WHERE ord < jsonb_array_length(v_deck)
             ) sub);

  v_new_version := COALESCE(v_game.version, 0) + 1;

  UPDATE game_players SET
    hand = v_hand,
    deck_pile = v_deck,
    deck_remaining = jsonb_array_length(v_deck),
    discard_pile = v_discard,
    free_draw_used = true,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id;

  UPDATE games SET version = v_new_version, updated_at = now() WHERE id = p_game_id;

  
  PERFORM public.ably_enqueue_game_sync(
    p_game_id,
    jsonb_build_object(
      'type', 'draw',
      'version', v_new_version,
      'actorId', p_player_id,
      'playerId', p_player_id,
      'rpcData', jsonb_build_object(
        'success', TRUE,
        'version', v_new_version,
        'hand_count', jsonb_array_length(v_hand),
        'deck_remaining', jsonb_array_length(v_deck),
        'draw_type', 'free'
      )
    )
  );


  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'hand_count', jsonb_array_length(v_hand),
    'deck_remaining', jsonb_array_length(v_deck),
    'draw_type', 'free'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.draw_card_for_action(
  p_game_id UUID,
  p_player_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game RECORD;
  v_player RECORD;
  v_hand JSONB;
  v_deck JSONB;
  v_discard JSONB;
  v_actions INT;
  v_new_version INT;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Игра не активна');
  END IF;
  IF v_game.current_player_id IS DISTINCT FROM p_player_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  SELECT * INTO v_player FROM game_players
    WHERE game_id = p_game_id AND player_id = p_player_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игрок не найден');
  END IF;

  IF COALESCE(v_player.paid_draw_used, false) THEN
    RETURN jsonb_build_object('error', 'Платный добор уже использован в этом ходу');
  END IF;

  v_actions := COALESCE(v_player.actions_remaining, 2);
  IF v_actions < 1 THEN
    RETURN jsonb_build_object('error', 'Нет доступных действий');
  END IF;

  v_hand := COALESCE(v_player.hand, '[]'::jsonb);
  v_deck := COALESCE(v_player.deck_pile, '[]'::jsonb);
  v_discard := COALESCE(v_player.discard_pile, '[]'::jsonb);

  IF jsonb_array_length(v_deck) < 1 AND jsonb_array_length(v_discard) > 0 THEN
    v_deck := v_discard;
    v_discard := '[]'::jsonb;
  END IF;

  IF jsonb_array_length(v_deck) < 1 THEN
    RETURN jsonb_build_object('error', 'Колода и сброс пусты');
  END IF;

  v_hand := v_hand || jsonb_build_array(v_deck -> (jsonb_array_length(v_deck) - 1));
  v_deck := (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
             FROM (
               SELECT value
               FROM jsonb_array_elements(v_deck) WITH ORDINALITY AS t(value, ord)
               WHERE ord < jsonb_array_length(v_deck)
             ) sub);

  v_new_version := COALESCE(v_game.version, 0) + 1;

  UPDATE game_players SET
    hand = v_hand,
    deck_pile = v_deck,
    deck_remaining = jsonb_array_length(v_deck),
    discard_pile = v_discard,
    actions_remaining = v_actions - 1,
    paid_draw_used = true,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id;

  UPDATE games SET version = v_new_version, updated_at = now() WHERE id = p_game_id;

  
  PERFORM public.ably_enqueue_game_sync(
    p_game_id,
    jsonb_build_object(
      'type', 'draw',
      'version', v_new_version,
      'actorId', p_player_id,
      'playerId', p_player_id,
      'rpcData', jsonb_build_object(
        'success', TRUE,
        'version', v_new_version,
        'hand_count', jsonb_array_length(v_hand),
        'deck_remaining', jsonb_array_length(v_deck),
        'draw_type', 'paid',
        'actions_remaining', v_actions - 1
      )
    )
  );


  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'hand_count', jsonb_array_length(v_hand),
    'deck_remaining', jsonb_array_length(v_deck),
    'actions_remaining', v_actions - 1,
    'draw_type', 'paid'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.shuffle_deck(
  p_game_id UUID,
  p_player_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game RECORD;
  v_player RECORD;
  v_combined JSONB;
  v_new_deck JSONB;
  v_discard JSONB;
  v_new_version INT;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Игра не активна');
  END IF;
  IF v_game.current_player_id IS DISTINCT FROM p_player_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  SELECT * INTO v_player FROM game_players
    WHERE game_id = p_game_id AND player_id = p_player_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игрок не найден');
  END IF;

  v_combined := COALESCE(v_player.hand, '[]'::jsonb) || COALESCE(v_player.deck_pile, '[]'::jsonb);
  v_discard := COALESCE(v_player.discard_pile, '[]'::jsonb);

  IF jsonb_array_length(v_combined) < 1 AND jsonb_array_length(v_discard) > 0 THEN
    v_combined := v_discard;
    v_discard := '[]'::jsonb;
  END IF;

  IF jsonb_array_length(v_combined) < 1 THEN
    RETURN jsonb_build_object('error', 'Нечего перемешивать');
  END IF;

  SELECT COALESCE(jsonb_agg(value ORDER BY random()), '[]'::jsonb)
  INTO v_new_deck
  FROM jsonb_array_elements(v_combined) AS t(value);

  v_new_version := COALESCE(v_game.version, 0) + 1;

  UPDATE game_players SET
    hand = '[]'::jsonb,
    deck_pile = v_new_deck,
    deck_remaining = jsonb_array_length(v_new_deck),
    discard_pile = v_discard,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id;

  UPDATE games SET version = v_new_version, updated_at = now() WHERE id = p_game_id;

  
  PERFORM public.ably_publish_game_reload(p_game_id, p_player_id, v_new_version);

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'deck_remaining', jsonb_array_length(v_new_deck),
    'hand_count', 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_from_hand(
  p_game_id UUID,
  p_player_id TEXT,
  p_card_index INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game RECORD;
  v_player RECORD;
  v_hand JSONB;
  v_discard JSONB;
  v_card JSONB;
  v_new_hand JSONB;
  v_new_version INT;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Игра не активна');
  END IF;
  IF v_game.current_player_id IS DISTINCT FROM p_player_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  SELECT * INTO v_player FROM game_players
    WHERE game_id = p_game_id AND player_id = p_player_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игрок не найден');
  END IF;

  v_hand := COALESCE(v_player.hand, '[]'::jsonb);
  v_discard := COALESCE(v_player.discard_pile, '[]'::jsonb);

  IF p_card_index < 0 OR p_card_index >= jsonb_array_length(v_hand) THEN
    RETURN jsonb_build_object('error', 'Неверный индекс карты');
  END IF;

  v_card := v_hand->p_card_index;
  v_new_hand := (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
             FROM (
               SELECT value, ordinality
               FROM jsonb_array_elements(v_hand) WITH ORDINALITY
               WHERE ordinality <> p_card_index + 1
             ) sub);

  v_discard := v_discard || jsonb_build_array(v_card);
  v_new_version := COALESCE(v_game.version, 0) + 1;

  UPDATE game_players SET
    hand = v_new_hand,
    discard_pile = v_discard,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id;

  UPDATE games SET version = v_new_version, updated_at = now() WHERE id = p_game_id;

  
  PERFORM public.ably_publish_game_reload(p_game_id, p_player_id, v_new_version);

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'hand_count', jsonb_array_length(v_new_hand),
    'discard_count', jsonb_array_length(v_discard)
  );
END;
$$;

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

  
  PERFORM public.ably_publish_game_reload(p_game_id, p_player_id, v_new_version + 1);

  RETURN jsonb_build_object('success', TRUE, 'version', v_new_version + 1, 'card', v_removed);
END;
$$;

CREATE OR REPLACE FUNCTION public.perform_attack(
  p_game_id UUID,
  p_player_id TEXT,
  p_from_zone INT,
  p_attacker_card_id TEXT,
  p_to_player_id TEXT,
  p_to_zone INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game RECORD;
  v_attacker RECORD;
  v_defender RECORD;
  v_from_cards JSONB;
  v_to_cards JSONB;
  v_attacker_card JSONB;
  v_creature JSONB;
  v_new_from JSONB := '[]'::jsonb;
  v_new_to JSONB := '[]'::jsonb;
  v_defender_discard JSONB;
  v_attacker_discard JSONB;
  elem JSONB;
  v_attack INT;
  v_counter INT;
  v_attacker_hp INT;
  v_defender_hp INT;
  v_new_attacker_hp INT;
  v_new_defender_hp INT;
  v_face_damage INT := 0;
  v_creature_killed BOOLEAN := FALSE;
  v_creature_damaged BOOLEAN := FALSE;
  v_attacker_killed BOOLEAN := FALSE;
  v_attacker_damaged BOOLEAN := FALSE;
  v_damage_amount INT := 0;
  v_alive_count INT;
  v_player_order INT;
  v_new_version INT;
  v_new_log JSONB;
  v_def_health INT;
  v_found BOOLEAN := FALSE;
  v_card_id TEXT;
  v_log_suffix TEXT := '';
BEGIN
  IF p_from_zone < 1 OR p_from_zone > 4 OR p_to_zone < 1 OR p_to_zone > 4 THEN
    RETURN jsonb_build_object('error', 'Неверная зона (1-4)');
  END IF;

  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Игра не активна');
  END IF;
  IF v_game.current_player_id IS DISTINCT FROM p_player_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;
  IF p_to_player_id = p_player_id THEN
    RETURN jsonb_build_object('error', 'Нельзя атаковать себя');
  END IF;

  SELECT * INTO v_attacker FROM game_players
    WHERE game_id = p_game_id AND player_id = p_player_id FOR UPDATE;
  SELECT * INTO v_defender FROM game_players
    WHERE game_id = p_game_id AND player_id = p_to_player_id FOR UPDATE;

  IF v_attacker.player_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Игрок не найден');
  END IF;
  IF v_defender.player_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Цель не найдена');
  END IF;
  IF COALESCE(v_defender.health, 0) <= 0 THEN
    RETURN jsonb_build_object('error', 'Цель уже выбыла');
  END IF;

  SELECT count(*) INTO v_alive_count FROM game_players
    WHERE game_id = p_game_id AND COALESCE(health, 0) > 0;

  v_player_order := COALESCE(v_attacker.player_order, 1);
  IF NOT public.can_player_deal_damage(v_player_order, v_alive_count, COALESCE(v_game.current_turn, 0)) THEN
    RETURN jsonb_build_object('error', 'Урон ещё недоступен (первый ход)');
  END IF;

  SELECT cards INTO v_from_cards FROM game_zones
    WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_from_zone;
  SELECT cards INTO v_to_cards FROM game_zones
    WHERE game_id = p_game_id AND player_id = p_to_player_id AND zone_position = p_to_zone;

  v_from_cards := COALESCE(v_from_cards, '[]'::jsonb);
  v_to_cards := COALESCE(v_to_cards, '[]'::jsonb);

  FOR elem IN SELECT value FROM jsonb_array_elements(v_from_cards) LOOP
    v_card_id := COALESCE(elem->>'id', elem->>'instanceId');
    IF v_card_id = p_attacker_card_id THEN
      v_attacker_card := elem;
      v_found := TRUE;
    ELSE
      v_new_from := v_new_from || jsonb_build_array(elem);
    END IF;
  END LOOP;

  IF NOT v_found OR v_attacker_card IS NULL THEN
    RETURN jsonb_build_object('error', 'Атакующая карта не найдена');
  END IF;

  IF COALESCE((v_attacker_card->>'tapped')::boolean, false) THEN
    RETURN jsonb_build_object('error', 'Карта уже использовалась');
  END IF;

  IF COALESCE(v_attacker_card->>'card_type', 'creature') IN ('building', 'spell') THEN
    RETURN jsonb_build_object('error', 'Строения и заклинания не атакуют');
  END IF;

  v_attack := COALESCE((v_attacker_card->>'attack')::int, 0);
  IF v_attack <= 0 THEN
    RETURN jsonb_build_object('error', 'У карты нет атаки');
  END IF;

  v_damage_amount := v_attack;
  v_creature := NULL;

  FOR elem IN SELECT value FROM jsonb_array_elements(v_to_cards) LOOP
    IF COALESCE(elem->>'card_type', 'creature') NOT IN ('building', 'spell') AND v_creature IS NULL THEN
      v_creature := elem;
    END IF;
  END LOOP;

  v_new_to := '[]'::jsonb;

  IF v_creature IS NULL THEN
    v_face_damage := v_attack;
    v_new_from := v_new_from || jsonb_build_array(v_attacker_card || jsonb_build_object('tapped', true));
  ELSE
    v_counter := COALESCE((v_creature->>'attack')::int, 0);
    v_attacker_hp := COALESCE((v_attacker_card->>'health')::int, COALESCE((v_attacker_card->>'defense')::int, 0));
    v_defender_hp := COALESCE((v_creature->>'health')::int, COALESCE((v_creature->>'defense')::int, 0));

    IF v_attack > v_defender_hp THEN
      v_creature_killed := TRUE;
    ELSE
      v_creature_damaged := TRUE;
      v_new_defender_hp := v_defender_hp - v_attack;
    END IF;

    IF v_counter > v_attacker_hp THEN
      v_attacker_killed := TRUE;
    ELSIF v_counter > 0 THEN
      v_attacker_damaged := TRUE;
      v_new_attacker_hp := v_attacker_hp - v_counter;
    END IF;

    FOR elem IN SELECT value FROM jsonb_array_elements(v_to_cards) LOOP
      IF COALESCE(elem->>'card_type', 'creature') NOT IN ('building', 'spell')
         AND COALESCE(elem->>'id', elem->>'instanceId') = COALESCE(v_creature->>'id', v_creature->>'instanceId') THEN
        IF NOT v_creature_killed THEN
          v_new_to := v_new_to || jsonb_build_array(elem || jsonb_build_object('health', v_new_defender_hp));
        END IF;
      ELSE
        v_new_to := v_new_to || jsonb_build_array(elem);
      END IF;
    END LOOP;

    IF v_creature_killed THEN
      v_defender_discard := COALESCE(v_defender.discard_pile, '[]'::jsonb) || jsonb_build_array(v_creature);
    END IF;

    IF v_attacker_killed THEN
      v_attacker_discard := COALESCE(v_attacker.discard_pile, '[]'::jsonb) || jsonb_build_array(v_attacker_card);
    ELSE
      v_new_from := v_new_from || jsonb_build_array(
        v_attacker_card || jsonb_build_object(
          'tapped', true,
          'health', CASE WHEN v_attacker_damaged THEN v_new_attacker_hp ELSE v_attacker_hp END
        )
      );
    END IF;
  END IF;

  v_def_health := COALESCE(v_defender.health, 25);
  IF v_face_damage > 0 THEN
    v_def_health := v_def_health - v_face_damage;
  END IF;

  UPDATE game_zones SET cards = v_new_from, updated_at = now()
    WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_from_zone;

  IF v_creature IS NOT NULL THEN
    UPDATE game_zones SET cards = v_new_to, updated_at = now()
      WHERE game_id = p_game_id AND player_id = p_to_player_id AND zone_position = p_to_zone;
    IF v_creature_killed THEN
      UPDATE game_players SET discard_pile = v_defender_discard, updated_at = now()
        WHERE game_id = p_game_id AND player_id = p_to_player_id;
    END IF;
    IF v_attacker_killed THEN
      UPDATE game_players SET discard_pile = v_attacker_discard, updated_at = now()
        WHERE game_id = p_game_id AND player_id = p_player_id;
    END IF;
  END IF;

  IF v_face_damage > 0 THEN
    UPDATE game_players SET health = v_def_health, updated_at = now()
      WHERE game_id = p_game_id AND player_id = p_to_player_id;
  END IF;

  v_log_suffix := CASE
    WHEN v_creature_killed AND v_attacker_killed THEN ' — оба существа погибли'
    WHEN v_creature_killed THEN ' — существо уничтожено'
    WHEN v_creature_damaged AND v_attacker_killed THEN format(' — урон по существу, атакующий погиб (сдача %s)', v_counter)
    WHEN v_creature_damaged AND v_attacker_damaged THEN format(' — урон по существу, сдача %s', v_counter)
    WHEN v_creature_damaged THEN ' — урон по существу'
    WHEN v_attacker_killed THEN format(' — атакующий погиб (сдача %s)', v_counter)
    WHEN v_face_damage > 0 THEN format(' — урон игроку (%s)', v_face_damage)
    ELSE ''
  END;

  v_new_log := COALESCE(v_game.game_state->'log', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'timestamp', (extract(epoch from now()) * 1000)::bigint,
      'message', format('%s атаковал (%s урона)%s',
        COALESCE(v_attacker.nickname, 'Игрок'),
        v_attack,
        v_log_suffix
      )
    )
  );

  v_new_version := COALESCE(v_game.version, 0) + 1;

  IF v_face_damage > 0 AND v_def_health <= 0 THEN
    UPDATE games SET
      status = 'finished',
      winner_id = p_player_id,
      ended_at = now(),
      version = v_new_version,
      game_state = COALESCE(v_game.game_state, '{}'::jsonb) || jsonb_build_object('log', v_new_log),
      updated_at = now()
    WHERE id = p_game_id;
  ELSE
    UPDATE games SET
      version = v_new_version,
      game_state = COALESCE(v_game.game_state, '{}'::jsonb) || jsonb_build_object('log', v_new_log),
      updated_at = now()
    WHERE id = p_game_id;
  END IF;

  
  PERFORM public.ably_enqueue_game_sync(
    p_game_id,
    jsonb_build_object(
      'type', 'attack',
      'version', v_new_version,
      'actorId', p_player_id,
      'rpcData', jsonb_build_object(
        'success', TRUE,
        'version', v_new_version,
        'from_player_id', p_player_id,
        'from_zone', p_from_zone,
        'to_player_id', p_to_player_id,
        'to_zone', p_to_zone,
        'damage', v_damage_amount,
        'counter_damage', CASE WHEN v_creature IS NULL THEN 0 ELSE COALESCE(v_counter, 0) END,
        'face_damage', v_face_damage,
        'creature_killed', v_creature_killed,
        'creature_damaged', v_creature_damaged,
        'attacker_killed', v_attacker_killed,
        'attacker_damaged', v_attacker_damaged,
        'defender_health', v_def_health,
        'game_finished', v_face_damage > 0 AND v_def_health <= 0
      )
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'from_player_id', p_player_id,
    'from_zone', p_from_zone,
    'to_player_id', p_to_player_id,
    'to_zone', p_to_zone,
    'damage', v_damage_amount,
    'counter_damage', CASE WHEN v_creature IS NULL THEN 0 ELSE COALESCE(v_counter, 0) END,
    'face_damage', v_face_damage,
    'creature_killed', v_creature_killed,
    'creature_damaged', v_creature_damaged,
    'attacker_killed', v_attacker_killed,
    'attacker_damaged', v_attacker_damaged,
    'defender_health', v_def_health,
    'game_finished', v_face_damage > 0 AND v_def_health <= 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.end_turn(
  p_game_id UUID,
  p_player_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game RECORD;
  v_attacker RECORD;
  v_current_idx INT;
  v_next_idx INT;
  v_next_player_id TEXT;
  v_next_player RECORD;
  v_new_version INT;
  v_player_ids TEXT[] := ARRAY[]::TEXT[];
  v_p RECORD;
  v_i INT;
  v_new_log JSONB;
  v_alive_count INT;
  v_zone RECORD;
  v_cards JSONB;
  v_new_cards JSONB;
  elem JSONB;
  v_battle_events JSONB := '[]'::jsonb;
  v_lane_result JSONB;
  v_target_player_id TEXT;
  v_target_zone INT;
  v_can_damage BOOLEAN;
  v_winner_id TEXT;
  v_game_finished BOOLEAN := FALSE;
  v_alive_after INT;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игра не найдена');
  END IF;

  IF v_game.status = 'finished' THEN
    RETURN jsonb_build_object('error', 'Игра уже завершена');
  END IF;

  IF v_game.current_player_id IS DISTINCT FROM p_player_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  SELECT * INTO v_attacker FROM game_players
    WHERE game_id = p_game_id AND player_id = p_player_id FOR UPDATE;

  FOR v_p IN
    SELECT gp.player_id
    FROM game_players gp
    WHERE gp.game_id = p_game_id AND COALESCE(gp.health, 0) > 0
    ORDER BY gp.player_order
  LOOP
    v_player_ids := array_append(v_player_ids, v_p.player_id);
  END LOOP;

  v_alive_count := array_length(v_player_ids, 1);
  IF v_alive_count IS NULL THEN
    RETURN jsonb_build_object('error', 'Нет живых игроков');
  END IF;

  IF v_alive_count = 1 AND v_player_ids[1] = p_player_id THEN
    RETURN jsonb_build_object('error', 'Вы единственный живой — игра окончена');
  END IF;

  v_can_damage := public.can_player_deal_damage(
    COALESCE(v_attacker.player_order, 1),
    v_alive_count,
    COALESCE(v_game.current_turn, 0)
  );

  IF v_can_damage THEN
    FOR v_i IN 1..4 LOOP
      SELECT t.target_player_id, t.target_zone INTO v_target_player_id, v_target_zone
      FROM public.get_battle_target(p_game_id, p_player_id, v_i, v_player_ids, v_alive_count) t
      LIMIT 1;

      IF v_target_player_id IS NULL THEN
        CONTINUE;
      END IF;

      v_lane_result := public.resolve_lane_battle(
        p_game_id, p_player_id, v_i, v_target_player_id, v_target_zone
      );

      IF COALESCE((v_lane_result->>'skipped')::boolean, false) THEN
        CONTINUE;
      END IF;

      v_battle_events := v_battle_events || jsonb_build_array(v_lane_result);

      IF COALESCE((v_lane_result->>'face_damage')::int, 0) > 0 THEN
        SELECT count(*) INTO v_alive_after FROM game_players
          WHERE game_id = p_game_id AND COALESCE(health, 0) > 0;
        IF v_alive_after <= 1 THEN
          v_game_finished := TRUE;
          v_winner_id := p_player_id;
        END IF;
      END IF;
    END LOOP;

    IF v_game_finished THEN
      v_new_log := COALESCE(v_game.game_state->'log', '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'timestamp', (extract(epoch from now()) * 1000)::bigint,
          'message', format('%s победил после боя!', COALESCE(v_attacker.nickname, 'Игрок'))
        )
      );
      v_new_version := COALESCE(v_game.version, 0) + 1;
      UPDATE games SET
        status = 'finished',
        winner_id = v_winner_id,
        ended_at = now(),
        version = v_new_version,
        game_state = COALESCE(v_game.game_state, '{}'::jsonb) || jsonb_build_object('log', v_new_log),
        updated_at = now()
      WHERE id = p_game_id;


      PERFORM public.ably_enqueue_game_sync(
        p_game_id,
        jsonb_build_object(
          'type', 'end_turn',
          'version', v_new_version,
          'actorId', p_player_id,
          'rpcData', jsonb_build_object(
            'success', TRUE,
            'version', v_new_version,
            'battle_events', v_battle_events,
            'game_finished', TRUE,
            'winner_id', v_winner_id
          )
        )
      );

      RETURN jsonb_build_object(
        'success', TRUE,
        'version', v_new_version,
        'battle_events', v_battle_events,
        'game_finished', TRUE,
        'winner_id', v_winner_id
      );
    END IF;

    SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  END IF;

  v_current_idx := -1;
  FOR v_i IN 1..v_alive_count LOOP
    IF v_player_ids[v_i] = p_player_id THEN
      v_current_idx := v_i - 1;
      EXIT;
    END IF;
  END LOOP;

  IF v_current_idx = -1 THEN
    RETURN jsonb_build_object('error', 'Игрок не найден среди живых');
  END IF;

  v_next_idx := (v_current_idx + 1) % v_alive_count;
  v_next_player_id := v_player_ids[v_next_idx + 1];

  SELECT * INTO v_next_player FROM game_players
    WHERE game_id = p_game_id AND player_id = v_next_player_id
    FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_next_player.health, 0) <= 0 THEN
    RETURN jsonb_build_object('error', 'Следующий игрок недоступен');
  END IF;

  -- NO auto-draw: reset actions + draw flags only
  UPDATE game_players SET
    actions_remaining = 2,
    free_draw_used = false,
    paid_draw_used = false,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = v_next_player_id;

  FOR v_zone IN
    SELECT zone_position, cards FROM game_zones
    WHERE game_id = p_game_id AND player_id = v_next_player_id
  LOOP
    v_cards := COALESCE(v_zone.cards, '[]'::jsonb);
    v_new_cards := '[]'::jsonb;
    FOR elem IN SELECT value FROM jsonb_array_elements(v_cards) LOOP
      v_new_cards := v_new_cards || jsonb_build_array(elem || jsonb_build_object('tapped', false));
    END LOOP;
    UPDATE game_zones SET cards = v_new_cards, updated_at = now()
    WHERE game_id = p_game_id AND player_id = v_next_player_id AND zone_position = v_zone.zone_position;
  END LOOP;

  v_new_log := COALESCE(v_game.game_state->'log', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'timestamp', (extract(epoch from now()) * 1000)::bigint,
      'message', CASE
        WHEN v_can_damage AND jsonb_array_length(v_battle_events) > 0 THEN
          format('BATTLE! %s · ход: %s · возьми карту кнопкой', COALESCE(v_attacker.nickname, 'игрок'), COALESCE(v_next_player.nickname, 'игрок'))
        ELSE format('Ход: %s · 2 действия · возьми карту кнопкой', COALESCE(v_next_player.nickname, 'игрок'))
      END
    )
  );

  v_new_version := COALESCE(v_game.version, 0) + 1;

  UPDATE games SET
    current_player_id = v_next_player_id,
    current_turn = COALESCE(v_game.current_turn, 0) + 1,
    version = v_new_version,
    game_state = COALESCE(v_game.game_state, '{}'::jsonb) || jsonb_build_object(
      'log', v_new_log,
      'turnPhase', 'main'
    ),
    updated_at = now(),
    turn_started_at = now()
  WHERE id = p_game_id;


      PERFORM public.ably_enqueue_game_sync(
        p_game_id,
        jsonb_build_object(
          'type', 'end_turn',
          'version', v_new_version,
          'actorId', p_player_id,
          'rpcData', jsonb_build_object(
            'success', TRUE,
            'version', v_new_version,
            'next_player_id', v_next_player_id,
            'drew_card', false,
            'actions_remaining', 2,
            'battle_events', v_battle_events,
            'game_finished', FALSE
          )
        )
      );

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'next_player_id', v_next_player_id,
    'drew_card', false,
    'actions_remaining', 2,
    'battle_events', v_battle_events,
    'game_finished', FALSE
  );
END;
$$;

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
      'turnPhase', 'main',
      'log', v_log || jsonb_build_array(jsonb_build_object(
        'timestamp', (extract(epoch from now()) * 1000)::bigint,
        'message', 'Первый ход · возьми бесплатную карту кнопкой · 2 действия'
      ))
    ),
    version = version + 1
  WHERE id = p_game_id;

  -- First player: 2 actions, draw flags reset (no auto-draw)
  UPDATE public.game_players SET
    actions_remaining = 2,
    free_draw_used = false,
    paid_draw_used = false,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = v_first_player_id;

  PERFORM public.ably_publish_game_reload(p_game_id, p_player_id, (SELECT version FROM public.games WHERE id = p_game_id));
END;
$function$;

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

  PERFORM public.ably_publish_game_reload(
    p_game_id,
    p_player_id,
    COALESCE((SELECT version FROM public.games WHERE id = p_game_id), 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.forfeit_game(
  p_guest_id TEXT,
  p_game_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_game RECORD;
  v_remaining TEXT[];
  v_players_ord TEXT[];
  v_my_idx INT;
  v_next_id TEXT;
  v_i INT;
  v_cand TEXT;
  v_winner TEXT;
  v_new_log JSONB;
  v_new_version INT;
BEGIN
  IF p_guest_id IS NULL OR length(trim(p_guest_id)) = 0 THEN
    RETURN jsonb_build_object('error', 'guest_id обязателен');
  END IF;

  PERFORM set_config('app.guest_id', p_guest_id, true);

  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игра не найдена');
  END IF;

  IF v_game.status = 'finished' THEN
    RETURN jsonb_build_object('error', 'Игра уже завершена');
  END IF;

  IF v_game.current_player_id IS DISTINCT FROM p_guest_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  -- Помечаем сдавшегося как мёртвого
  UPDATE game_players
  SET health = 0, updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_guest_id;

  -- Считаем оставшихся живых (исключая меня)
  SELECT array_agg(gp.player_id ORDER BY gp.player_order)
  INTO v_remaining
  FROM game_players gp
  WHERE gp.game_id = p_game_id
    AND gp.player_id <> p_guest_id
    AND COALESCE(gp.health, 0) > 0;

  v_new_log := COALESCE(v_game.game_state->'log', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'timestamp', (extract(epoch from now()) * 1000)::bigint,
      'message', format('Игрок сдался. Осталось в игре: %s.', COALESCE(array_length(v_remaining, 1), 0))
    )
  );

  v_new_version := COALESCE(v_game.version, 0) + 1;

  -- 0 или 1 живой → игра окончена
  IF v_remaining IS NULL OR array_length(v_remaining, 1) <= 1 THEN
    v_winner := CASE WHEN v_remaining IS NOT NULL AND array_length(v_remaining, 1) = 1 THEN v_remaining[1] ELSE NULL END;
    UPDATE games SET
      status = 'finished',
      winner_id = v_winner,
      current_player_id = COALESCE(v_winner, p_guest_id),
      game_state = COALESCE(v_game.game_state, '{}'::jsonb) || jsonb_build_object('log', v_new_log),
      version = v_new_version,
      ended_at = now(),
      updated_at = now()
    WHERE id = p_game_id;

    PERFORM public.ably_publish_game_reload(p_game_id, p_guest_id, v_new_version);
    RETURN jsonb_build_object('success', TRUE, 'finished', TRUE, 'winner_id', v_winner, 'version', v_new_version);
  END IF;

  -- 2+ живых → игра продолжается, передаём ход следующему живому по кругу
  SELECT array_agg(gp.player_id ORDER BY gp.player_order)
  INTO v_players_ord
  FROM game_players gp
  WHERE gp.game_id = p_game_id;

  v_my_idx := array_position(v_players_ord, p_guest_id);
  v_next_id := v_remaining[1];

  IF v_my_idx IS NOT NULL AND v_players_ord IS NOT NULL THEN
    FOR v_i IN 1..array_length(v_players_ord, 1) LOOP
      v_cand := v_players_ord[1 + ((v_my_idx - 1 + v_i) % array_length(v_players_ord, 1))];
      IF v_cand = ANY(v_remaining) THEN
        v_next_id := v_cand;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  UPDATE games SET
    current_player_id = v_next_id,
    current_turn = COALESCE(v_game.current_turn, 0) + 1,
    game_state = COALESCE(v_game.game_state, '{}'::jsonb) || jsonb_build_object('log', v_new_log),
    version = v_new_version,
    updated_at = now(),
    turn_started_at = now()
  WHERE id = p_game_id;

  PERFORM public.ably_publish_game_reload(p_game_id, p_guest_id, v_new_version);
  RETURN jsonb_build_object(
    'success', TRUE,
    'finished', FALSE,
    'current_player_id', v_next_id,
    'version', v_new_version
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.flip_card(
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
  v_game RECORD;
  v_zone JSONB;
  v_new_zone JSONB := '[]'::jsonb;
  v_new_version INT;
  elem JSONB;
  v_card_id TEXT;
  v_found BOOLEAN := FALSE;
BEGIN
  IF p_zone_position < 1 OR p_zone_position > 4 THEN
    RETURN jsonb_build_object('error', 'Неверная позиция зоны (1-4)');
  END IF;

  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Игра не активна');
  END IF;

  SELECT COALESCE(cards, '[]'::jsonb) INTO v_zone
  FROM game_zones
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position
  FOR UPDATE;

  IF v_zone IS NULL THEN
    RETURN jsonb_build_object('error', 'Зона не найдена');
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(v_zone) LOOP
    v_card_id := COALESCE(elem->>'id', elem->>'instanceId');
    IF NOT v_found AND v_card_id = p_card_id THEN
      v_found := TRUE;
      v_new_zone := v_new_zone || jsonb_build_array(
        elem || jsonb_build_object('status', 'flipped', 'flipped', true)
      );
    ELSE
      v_new_zone := v_new_zone || jsonb_build_array(elem);
    END IF;
  END LOOP;

  IF NOT v_found THEN
    RETURN jsonb_build_object('error', 'Карта не найдена');
  END IF;

  v_new_version := COALESCE(v_game.version, 0) + 1;

  UPDATE game_zones SET cards = v_new_zone, updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position;

  UPDATE games SET version = v_new_version, updated_at = now() WHERE id = p_game_id;

  PERFORM public.ably_enqueue_game_sync(
    p_game_id,
    jsonb_build_object(
      'type', 'flip_card',
      'version', v_new_version,
      'actorId', p_player_id,
      'playerId', p_player_id,
      'zoneIndex', p_zone_position - 1,
      'cardId', p_card_id
    )
  );

  RETURN jsonb_build_object('success', TRUE, 'version', v_new_version);
END;
$$;

GRANT EXECUTE ON FUNCTION public.flip_card(UUID, TEXT, INT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.leave_lobby(
  p_guest_id TEXT,
  p_lobby_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host_id TEXT;
BEGIN
  IF p_guest_id IS NULL OR length(trim(p_guest_id)) < 16 THEN
    RAISE EXCEPTION 'Некорректный guest_id';
  END IF;
  PERFORM set_config('app.guest_id', p_guest_id, true);

  SELECT host_id INTO v_host_id FROM public.lobbies WHERE id = p_lobby_id;
  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'Лобби не найдено';
  END IF;

  IF v_host_id = p_guest_id THEN
    PERFORM public.ably_enqueue_lobby_sync(
      p_lobby_id,
      jsonb_build_object('type', 'closed', 'actorId', p_guest_id)
    );
    DELETE FROM public.lobbies WHERE id = p_lobby_id;
    RETURN;
  END IF;

  DELETE FROM public.lobby_players
  WHERE lobby_id = p_lobby_id AND player_id = p_guest_id;

  PERFORM public.ably_publish_lobby_players(p_lobby_id, p_guest_id);
END;
$$;

REVOKE ALL ON FUNCTION public.leave_lobby(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_lobby(TEXT, UUID) TO anon, authenticated;

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
  IF p_lobby_id IS NULL THEN RAISE EXCEPTION 'lobby_id обязателен'; END IF;

  normalized_nickname := left(coalesce(nullif(trim(p_nickname), ''), 'Игрок'), 80);
  PERFORM set_config('app.guest_id', p_guest_id, true);

  IF NOT EXISTS (SELECT 1 FROM public.lobbies WHERE id = p_lobby_id AND status = 'waiting') THEN
    RAISE EXCEPTION 'Лобби не найдено или уже закрыто';
  END IF;

  SELECT lp.* INTO result
  FROM public.lobby_players lp
  WHERE lp.lobby_id = p_lobby_id AND lp.player_id = p_guest_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.lobby_players
    SET nickname = normalized_nickname, ready = coalesce(p_ready, false), deck = p_deck
    WHERE lobby_id = p_lobby_id AND player_id = p_guest_id
    RETURNING * INTO result;
  ELSE
    IF (SELECT count(*) FROM public.lobby_players WHERE lobby_id = p_lobby_id) >= 4 THEN
      RAISE EXCEPTION 'Лобби уже заполнено';
    END IF;
    INSERT INTO public.lobby_players (lobby_id, player_id, nickname, ready, deck)
    VALUES (p_lobby_id, p_guest_id, normalized_nickname, coalesce(p_ready, false), p_deck)
    RETURNING * INTO result;
  END IF;

  PERFORM public.ably_publish_lobby_players(p_lobby_id, p_guest_id);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_lobby_player_ready(
  p_guest_id text,
  p_lobby_id uuid,
  p_ready boolean DEFAULT true
)
RETURNS public.lobby_players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result public.lobby_players;
BEGIN
  IF p_guest_id IS NULL OR length(trim(p_guest_id)) < 16 THEN
    RAISE EXCEPTION 'Некорректный guest_id';
  END IF;
  PERFORM set_config('app.guest_id', p_guest_id, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.lobby_players
    WHERE lobby_id = p_lobby_id AND player_id = p_guest_id
  ) THEN
    RAISE EXCEPTION 'Вы не в этом лобби';
  END IF;

  UPDATE public.lobby_players
  SET ready = coalesce(p_ready, true)
  WHERE lobby_id = p_lobby_id AND player_id = p_guest_id
  RETURNING * INTO result;
  PERFORM public.ably_publish_lobby_players(p_lobby_id, p_guest_id);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_game_for_lobby(p_guest_id text, p_lobby_id uuid, p_land_placement_rule text DEFAULT 'strict')
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
      'landPlacementRule', coalesce(nullif(p_land_placement_rule, ''), 'strict'),
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

  PERFORM public.ably_enqueue_lobby_sync(
    p_lobby_id,
    jsonb_build_object(
      'type', 'game_started',
      'gameId', v_game_id,
      'status', 'in_game',
      'actorId', p_guest_id
    )
  );

  RETURN v_game_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';