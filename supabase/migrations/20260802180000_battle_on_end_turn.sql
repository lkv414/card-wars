-- Фаза боя при end_turn (кнопка BATTLE!): все существа бьют по линиям, потом передача хода.

CREATE OR REPLACE FUNCTION public.get_battle_target(
  p_game_id UUID,
  p_attacker_id TEXT,
  p_from_zone INT,
  p_alive_ids TEXT[],
  p_alive_count INT
)
RETURNS TABLE(target_player_id TEXT, target_zone INT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_attacker_idx INT := -1;
  v_i INT;
  v_direction INT;
  v_target_idx INT;
  v_target_zone INT;
BEGIN
  IF p_from_zone < 1 OR p_from_zone > 4 OR p_alive_count < 2 THEN
    RETURN;
  END IF;

  IF p_alive_count <= 2 THEN
    FOR v_i IN 1..p_alive_count LOOP
      IF p_alive_ids[v_i] <> p_attacker_id THEN
        target_player_id := p_alive_ids[v_i];
        target_zone := p_from_zone;
        RETURN NEXT;
        RETURN;
      END IF;
    END LOOP;
    RETURN;
  END IF;

  FOR v_i IN 1..p_alive_count LOOP
    IF p_alive_ids[v_i] = p_attacker_id THEN
      v_attacker_idx := v_i - 1;
      EXIT;
    END IF;
  END LOOP;
  IF v_attacker_idx = -1 THEN RETURN; END IF;

  v_direction := CASE WHEN p_from_zone <= 2 THEN 1 ELSE -1 END;
  v_target_idx := (v_attacker_idx + v_direction + p_alive_count * 2) % p_alive_count;
  target_player_id := p_alive_ids[v_target_idx + 1];
  target_zone := ((p_from_zone + 1) % 4) + 1; -- 1→3, 2→4, 3→1, 4→2
  IF p_from_zone <= 2 THEN
    target_zone := p_from_zone + 2;
  ELSE
    target_zone := p_from_zone - 2;
  END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_lane_battle(
  p_game_id UUID,
  p_attacker_id TEXT,
  p_from_zone INT,
  p_defender_id TEXT,
  p_to_zone INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  v_card_id TEXT;
  v_found BOOLEAN := FALSE;
  v_defender RECORD;
BEGIN
  SELECT * INTO v_defender FROM game_players
    WHERE game_id = p_game_id AND player_id = p_defender_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_defender.health, 0) <= 0 THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  SELECT cards INTO v_from_cards FROM game_zones
    WHERE game_id = p_game_id AND player_id = p_attacker_id AND zone_position = p_from_zone;
  SELECT cards INTO v_to_cards FROM game_zones
    WHERE game_id = p_game_id AND player_id = p_defender_id AND zone_position = p_to_zone;

  v_from_cards := COALESCE(v_from_cards, '[]'::jsonb);
  v_to_cards := COALESCE(v_to_cards, '[]'::jsonb);

  FOR elem IN SELECT value FROM jsonb_array_elements(v_from_cards) LOOP
    IF NOT v_found
       AND COALESCE(elem->>'card_type', 'creature') NOT IN ('building', 'spell')
       AND COALESCE((elem->>'tapped')::boolean, false) = false
       AND COALESCE((elem->>'flipped')::boolean, false) = false
       AND COALESCE((elem->>'isFlipped')::boolean, false) = false
       AND COALESCE((elem->>'attack')::int, 0) > 0 THEN
      v_attacker_card := elem;
      v_found := TRUE;
    ELSE
      v_new_from := v_new_from || jsonb_build_array(elem);
    END IF;
  END LOOP;

  IF NOT v_found OR v_attacker_card IS NULL THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  v_attack := COALESCE((v_attacker_card->>'attack')::int, 0);
  v_creature := NULL;

  FOR elem IN SELECT value FROM jsonb_array_elements(v_to_cards) LOOP
    IF COALESCE(elem->>'card_type', 'creature') NOT IN ('building', 'spell') AND v_creature IS NULL THEN
      v_creature := elem;
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

  UPDATE game_zones SET cards = v_new_from, updated_at = now()
    WHERE game_id = p_game_id AND player_id = p_attacker_id AND zone_position = p_from_zone;

  IF v_creature IS NOT NULL THEN
    UPDATE game_zones SET cards = v_new_to, updated_at = now()
      WHERE game_id = p_game_id AND player_id = p_defender_id AND zone_position = p_to_zone;
    IF v_creature_killed THEN
      UPDATE game_players SET discard_pile = v_new_discard, updated_at = now()
        WHERE game_id = p_game_id AND player_id = p_defender_id;
    END IF;
  END IF;

  IF v_face_damage > 0 THEN
    UPDATE game_players SET health = GREATEST(0, COALESCE(health, 25) - v_face_damage), updated_at = now()
      WHERE game_id = p_game_id AND player_id = p_defender_id;
  END IF;

  RETURN jsonb_build_object(
    'from_zone', p_from_zone,
    'to_player_id', p_defender_id,
    'to_zone', p_to_zone,
    'damage', v_attack,
    'face_damage', v_face_damage,
    'creature_killed', v_creature_killed,
    'creature_damaged', v_creature_damaged
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
  END IF;

  UPDATE game_players SET
    hand = v_hand,
    deck_pile = v_deck,
    deck_remaining = jsonb_array_length(v_deck),
    actions_remaining = 2,
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
          format('BATTLE! %s · ход: %s', COALESCE(v_attacker.nickname, 'игрок'), COALESCE(v_next_player.nickname, 'игрок'))
        WHEN v_drew_card THEN format('Ход: %s · +1 карта · 2 действия', COALESCE(v_next_player.nickname, 'игрок'))
        ELSE format('Ход: %s · колода пуста · 2 действия', COALESCE(v_next_player.nickname, 'игрок'))
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

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'next_player_id', v_next_player_id,
    'drew_card', v_drew_card,
    'hand_count', jsonb_array_length(v_hand),
    'deck_remaining', jsonb_array_length(v_deck),
    'actions_remaining', 2,
    'battle_events', v_battle_events,
    'game_finished', FALSE
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
