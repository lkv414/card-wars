-- Действия за ход, draw без refill, бой с правилами Card Wars.

CREATE OR REPLACE FUNCTION public.can_player_deal_damage(
  p_player_order INT,
  p_player_count INT,
  p_current_turn INT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_player_order >= p_player_count THEN TRUE
    ELSE p_current_turn >= p_player_count - 1
  END;
$$;

-- play_card: −1 действие, без автодобора из колоды
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
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Игра не активна');
  END IF;
  IF v_game.current_player_id IS DISTINCT FROM p_player_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  v_actions := COALESCE((v_game.game_state->>'actionsRemaining')::int, 2);
  IF v_actions < 1 THEN
    RETURN jsonb_build_object('error', 'Нет доступных действий');
  END IF;

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
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id;

  UPDATE game_zones SET
    cards = v_target_zone,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position;

  UPDATE games SET
    version = v_new_version,
    game_state = COALESCE(v_game.game_state, '{}'::jsonb) || jsonb_build_object(
      'actionsRemaining', v_actions - 1
    ),
    updated_at = now()
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'hand_count', jsonb_array_length(v_new_hand),
    'deck_remaining', jsonb_array_length(v_deck),
    'actions_remaining', v_actions - 1,
    'card', v_card,
    'slot_type', v_slot
  );
END;
$$;

-- Добор 1 карты за 1 действие
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

  v_actions := COALESCE((v_game.game_state->>'actionsRemaining')::int, 2);
  IF v_actions < 1 THEN
    RETURN jsonb_build_object('error', 'Нет доступных действий');
  END IF;

  SELECT * INTO v_player FROM game_players
    WHERE game_id = p_game_id AND player_id = p_player_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игрок не найден');
  END IF;

  v_hand := COALESCE(v_player.hand, '[]'::jsonb);
  v_deck := COALESCE(v_player.deck_pile, '[]'::jsonb);

  IF jsonb_array_length(v_deck) < 1 THEN
    RETURN jsonb_build_object('error', 'Колода пуста');
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
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id;

  UPDATE games SET
    version = v_new_version,
    game_state = COALESCE(v_game.game_state, '{}'::jsonb) || jsonb_build_object(
      'actionsRemaining', v_actions - 1
    ),
    updated_at = now()
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'hand_count', jsonb_array_length(v_hand),
    'deck_remaining', jsonb_array_length(v_deck),
    'actions_remaining', v_actions - 1
  );
END;
$$;

-- end_turn: добор 1 карты, сброс действий, untap
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
  v_current_idx INT;
  v_next_idx INT;
  v_next_player_id TEXT;
  v_next_player RECORD;
  v_deck JSONB;
  v_hand JSONB;
  v_drew_card BOOLEAN := FALSE;
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

  v_deck := COALESCE(v_next_player.deck_pile, '[]'::jsonb);
  v_hand := COALESCE(v_next_player.hand, '[]'::jsonb);

  IF jsonb_array_length(v_deck) > 0 THEN
    v_hand := v_hand || jsonb_build_array(v_deck -> (jsonb_array_length(v_deck) - 1));
    v_deck := (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
               FROM (
                 SELECT value
                 FROM jsonb_array_elements(v_deck) WITH ORDINALITY AS t(value, ord)
                 WHERE ord < jsonb_array_length(v_deck)
               ) sub);
    v_drew_card := TRUE;

    UPDATE game_players SET
      hand = v_hand,
      deck_pile = v_deck,
      deck_remaining = jsonb_array_length(v_deck),
      updated_at = now()
    WHERE game_id = p_game_id AND player_id = v_next_player_id;
  END IF;

  -- Untap все карты следующего игрока
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
        WHEN v_drew_card THEN format('Ход: %s · +1 карта', COALESCE(v_next_player.nickname, 'игрок'))
        ELSE format('Ход: %s · колода пуста', COALESCE(v_next_player.nickname, 'игрок'))
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
      'actionsRemaining', 2,
      'turnPhase', 'main'
    ),
    updated_at = now(),
    turn_started_at = now()
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'next_player_id', v_next_player_id,
    'drew_card', v_drew_card,
    'hand_count', jsonb_array_length(v_hand),
    'deck_remaining', jsonb_array_length(v_deck),
    'actions_remaining', 2
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.draw_card_for_action(UUID, TEXT) TO anon, authenticated;

-- Атака: урон по существу (kill если damage > hp) или по игроку
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
  v_new_discard JSONB;
  elem JSONB;
  v_attack INT;
  v_hp INT;
  v_new_hp INT;
  v_face_damage INT := 0;
  v_creature_killed BOOLEAN := FALSE;
  v_creature_damaged BOOLEAN := FALSE;
  v_damage_amount INT := 0;
  v_alive_count INT;
  v_player_order INT;
  v_new_version INT;
  v_new_log JSONB;
  v_def_health INT;
  v_found BOOLEAN := FALSE;
  v_card_id TEXT;
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
    IF COALESCE(elem->>'card_type', 'creature') NOT IN ('building', 'spell') THEN
      IF v_creature IS NULL THEN
        v_creature := elem;
      END IF;
    END IF;
  END LOOP;

  v_new_to := '[]'::jsonb;

  IF v_creature IS NULL THEN
    v_face_damage := v_attack;
  ELSE
    v_hp := COALESCE((v_creature->>'health')::int, COALESCE((v_creature->>'defense')::int, 0));
    IF v_attack > v_hp THEN
      v_creature_killed := TRUE;
      v_new_discard := COALESCE(v_defender.discard_pile, '[]'::jsonb) || jsonb_build_array(v_creature);
      FOR elem IN SELECT value FROM jsonb_array_elements(v_to_cards) LOOP
        v_card_id := COALESCE(elem->>'id', elem->>'instanceId');
        IF COALESCE(elem->>'card_type', 'creature') NOT IN ('building', 'spell')
           AND COALESCE(elem->>'id', elem->>'instanceId') = COALESCE(v_creature->>'id', v_creature->>'instanceId') THEN
          NULL;
        ELSE
          v_new_to := v_new_to || jsonb_build_array(elem);
        END IF;
      END LOOP;
    ELSE
      v_creature_damaged := TRUE;
      v_new_hp := v_hp - v_attack;
      FOR elem IN SELECT value FROM jsonb_array_elements(v_to_cards) LOOP
        v_card_id := COALESCE(elem->>'id', elem->>'instanceId');
        IF COALESCE(elem->>'card_type', 'creature') NOT IN ('building', 'spell')
           AND COALESCE(elem->>'id', elem->>'instanceId') = COALESCE(v_creature->>'id', v_creature->>'instanceId') THEN
          v_new_to := v_new_to || jsonb_build_array(elem || jsonb_build_object('health', v_new_hp));
        ELSE
          v_new_to := v_new_to || jsonb_build_array(elem);
        END IF;
      END LOOP;
    END IF;
  END IF;

  v_new_from := v_new_from || jsonb_build_array(v_attacker_card || jsonb_build_object('tapped', true));

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
      UPDATE game_players SET discard_pile = v_new_discard, updated_at = now()
        WHERE game_id = p_game_id AND player_id = p_to_player_id;
    END IF;
  END IF;

  IF v_face_damage > 0 THEN
    UPDATE game_players SET health = v_def_health, updated_at = now()
      WHERE game_id = p_game_id AND player_id = p_to_player_id;
  END IF;

  v_new_log := COALESCE(v_game.game_state->'log', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'timestamp', (extract(epoch from now()) * 1000)::bigint,
      'message', format('%s атаковал (%s урона)%s',
        COALESCE(v_attacker.nickname, 'Игрок'),
        v_attack,
        CASE
          WHEN v_creature_killed THEN ' — существо уничтожено'
          WHEN v_creature_damaged THEN ' — урон по существу'
          WHEN v_face_damage > 0 THEN format(' — урон игроку (%s)', v_face_damage)
          ELSE ''
        END
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

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'damage', v_damage_amount,
    'face_damage', v_face_damage,
    'creature_killed', v_creature_killed,
    'creature_damaged', v_creature_damaged,
    'defender_health', v_def_health,
    'game_finished', v_face_damage > 0 AND v_def_health <= 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.perform_attack(UUID, TEXT, INT, TEXT, TEXT, INT) TO anon, authenticated;

-- confirm_land_setup: actionsRemaining при старте
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
      'actionsRemaining', 2,
      'log', v_log
    ),
    version = version + 1
  WHERE id = p_game_id;
END;
$function$;

-- get_player_game_state: actions_remaining
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
    'actions_remaining', COALESCE((g.game_state->>'actionsRemaining')::int, 2),
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

NOTIFY pgrst, 'reload schema';
