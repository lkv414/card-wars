-- Сдача: при ударе по существу противник наносит урон атакующему одновременно.

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
  v_attacker_player RECORD;
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
  v_found BOOLEAN := FALSE;
  v_defender RECORD;
BEGIN
  SELECT * INTO v_attacker_player FROM game_players
    WHERE game_id = p_game_id AND player_id = p_attacker_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

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
      v_attacker_discard := COALESCE(v_attacker_player.discard_pile, '[]'::jsonb) || jsonb_build_array(v_attacker_card);
    ELSE
      v_new_from := v_new_from || jsonb_build_array(
        v_attacker_card || jsonb_build_object(
          'tapped', true,
          'health', CASE WHEN v_attacker_damaged THEN v_new_attacker_hp ELSE v_attacker_hp END
        )
      );
    END IF;
  END IF;

  UPDATE game_zones SET cards = v_new_from, updated_at = now()
    WHERE game_id = p_game_id AND player_id = p_attacker_id AND zone_position = p_from_zone;

  IF v_creature IS NOT NULL THEN
    UPDATE game_zones SET cards = v_new_to, updated_at = now()
      WHERE game_id = p_game_id AND player_id = p_defender_id AND zone_position = p_to_zone;
    IF v_creature_killed THEN
      UPDATE game_players SET discard_pile = v_defender_discard, updated_at = now()
        WHERE game_id = p_game_id AND player_id = p_defender_id;
    END IF;
    IF v_attacker_killed THEN
      UPDATE game_players SET discard_pile = v_attacker_discard, updated_at = now()
        WHERE game_id = p_game_id AND player_id = p_attacker_id;
    END IF;
  END IF;

  IF v_face_damage > 0 THEN
    UPDATE game_players SET health = GREATEST(0, COALESCE(health, 25) - v_face_damage), updated_at = now()
      WHERE game_id = p_game_id AND player_id = p_defender_id;
  END IF;

  RETURN jsonb_build_object(
    'from_player_id', p_attacker_id,
    'from_zone', p_from_zone,
    'to_player_id', p_defender_id,
    'to_zone', p_to_zone,
    'damage', v_attack,
    'counter_damage', CASE WHEN v_creature IS NULL THEN 0 ELSE COALESCE(v_counter, 0) END,
    'face_damage', v_face_damage,
    'creature_killed', v_creature_killed,
    'creature_damaged', v_creature_damaged,
    'attacker_killed', v_attacker_killed,
    'attacker_damaged', v_attacker_damaged
  );
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

NOTIFY pgrst, 'reload schema';
