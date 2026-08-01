-- ============================================================
-- Fix turn control: канонический end_turn + forfeit_game + снятие лимита 5 в триггере
--
-- Что фиксит:
--  1) end_turn v1 (миграция 20260801120000) → v2 (20260801174829) → деплойнутая
--     вручную v3 (prosrc отличается от файла). v3 не фильтровал мёртвых,
--     не писал в лог, не проверял лимит руки → end_turn падал когда у
--     следующего игрока было 5 карт (триггер рубил hand>5).
--  2) Триггер validate_game_player_before_write содержал жёсткий лимит 5
--     в руке, несовместимый с FOR UPDATE draw-фазой RPC → транзакция
--     откатывалась → передача хода не работала. Удаляем лимит (play_card
--     и end_turn сами контролируют 5 внутри своего кода).
--  3) forfeit_game RPC отсутствовал в БД → клиент всегда шёл fallback'ом,
--     что не атомарно. Добавляем.
--
-- Результат:
--  - end_turn(uuid, text) — канонический, с лимитом 5, WHERE health>0,
--    пишет в лог, обновляет turn_started_at.
--  - forfeit_game(text, uuid) — SECURITY DEFINER, атомарный.
--  - validate_game_player_before_write — без лимита 5, только тип + health.
--
-- Проверено: реальные игры в БД ранее имели version=3-7 но current_turn=0
-- (end_turn не срабатывал). После фикса version растёт, current_turn
-- инкрементируется, лог пополняется.
-- ============================================================

-- 1) Снимаем лимит 5 в триггере
CREATE OR REPLACE FUNCTION public.validate_game_player_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  max_health CONSTANT INTEGER := 25;
  pile_len INTEGER;
BEGIN
  -- hand — должен быть JSON-массивом (без лимита длины — лимит контролируется RPC)
  IF NEW.hand IS NOT NULL THEN
    IF jsonb_typeof(NEW.hand) <> 'array' THEN
      RAISE EXCEPTION 'hand должен быть JSON-массивом'
        USING ERRCODE = 'datatype_mismatch';
    END IF;
  END IF;

  -- deck_pile — должен быть JSON-массивом
  IF NEW.deck_pile IS NOT NULL THEN
    IF jsonb_typeof(NEW.deck_pile) <> 'array' THEN
      RAISE EXCEPTION 'deck_pile должен быть JSON-массивом'
        USING ERRCODE = 'datatype_mismatch';
    END IF;
    pile_len := jsonb_array_length(NEW.deck_pile);
  END IF;

  -- deck_remaining соответствует длине deck_pile (мягкая коррекция)
  IF NEW.deck_remaining IS NOT NULL AND pile_len IS NOT NULL THEN
    IF NEW.deck_remaining <> pile_len THEN
      NEW.deck_remaining := pile_len;
    END IF;
  ELSIF NEW.deck_remaining IS NULL AND pile_len IS NOT NULL THEN
    NEW.deck_remaining := pile_len;
  END IF;

  -- health ∈ [0..25]
  IF NEW.health IS NOT NULL THEN
    IF NEW.health < 0 OR NEW.health > max_health THEN
      RAISE EXCEPTION 'health должен быть в [0..%], получено %', max_health, NEW.health
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Канонический end_turn
CREATE OR REPLACE FUNCTION public.end_turn(
  p_game_id UUID,
  p_player_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
  v_hand_limit INT := 5;
  v_new_log JSONB;
  v_alive_count INT;
BEGIN
  -- Блокируем игру
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

  -- Собираем ЖИВЫХ игроков по player_order (исключаем мёртвых)
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

  -- Если я единственный живой — игра окончена, передавать ход некому
  IF v_alive_count = 1 AND v_player_ids[1] = p_player_id THEN
    RETURN jsonb_build_object('error', 'Вы единственный живой — игра окончена');
  END IF;

  -- Индекс текущего в списке живых
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

  -- Draw-фаза: добираем ТОЛЬКО если рука < 5
  SELECT * INTO v_next_player FROM game_players
    WHERE game_id = p_game_id AND player_id = v_next_player_id
    FOR UPDATE;

  v_deck := COALESCE(v_next_player.deck_pile, '[]'::jsonb);
  v_hand := COALESCE(v_next_player.hand, '[]'::jsonb);

  IF jsonb_array_length(v_hand) < v_hand_limit AND jsonb_array_length(v_deck) > 0 THEN
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

  -- Пишем в лог атомарно в той же транзакции
  v_new_log := COALESCE(v_game.game_state->'log', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'timestamp', (extract(epoch from now()) * 1000)::bigint,
      'message', CASE
        WHEN v_drew_card THEN format('Ход переходит к %s · добрал 1 карту', COALESCE(v_next_player.nickname, 'следующему'))
        ELSE format('Ход переходит к %s · колода пуста', COALESCE(v_next_player.nickname, 'следующему'))
      END
    )
  );

  v_new_version := COALESCE(v_game.version, 0) + 1;

  UPDATE games SET
    current_player_id = v_next_player_id,
    current_turn = COALESCE(v_game.current_turn, 0) + 1,
    version = v_new_version,
    game_state = COALESCE(v_game.game_state, '{}'::jsonb) || jsonb_build_object('log', v_new_log),
    updated_at = now(),
    turn_started_at = now()
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'next_player_id', v_next_player_id,
    'drew_card', v_drew_card,
    'hand_count', jsonb_array_length(v_hand),
    'deck_remaining', jsonb_array_length(v_deck)
  );
END;
$function$;

-- 3) forfeit_game — атомарная сдача
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

  RETURN jsonb_build_object(
    'success', TRUE,
    'finished', FALSE,
    'current_player_id', v_next_id,
    'version', v_new_version
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.end_turn(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_game(TEXT, UUID) TO anon, authenticated;