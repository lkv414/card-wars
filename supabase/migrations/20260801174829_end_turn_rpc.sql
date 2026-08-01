-- end_turn RPC (v3): атомарная передача хода с draw-фазой (без превышения 5 карт).
-- Игроки берутся из таблицы game_players. Лимит руки STARTING_HAND_SIZE = 5.

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
  v_drawn_card JSONB;
  v_new_version INT;
  v_player_ids TEXT[] := ARRAY[]::TEXT[];
  v_i INT;
  v_p RECORD;
  v_hand_limit INT := 5;  -- STARTING_HAND_SIZE
BEGIN
  -- Блокируем строку игры
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Игра не найдена');
  END IF;

  -- Только текущий игрок может передать ход
  IF v_game.current_player_id <> p_player_id THEN
    RETURN jsonb_build_object('error', 'Сейчас не ваш ход');
  END IF;

  -- Собираем player_id по player_order
  FOR v_p IN
    SELECT gp.player_id
    FROM game_players gp
    WHERE gp.game_id = p_game_id
    ORDER BY gp.player_order
  LOOP
    v_player_ids := array_append(v_player_ids, v_p.player_id);
  END LOOP;

  IF array_length(v_player_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'Игроки не найдены');
  END IF;

  -- Индекс текущего игрока
  v_current_idx := -1;
  FOR v_i IN 1..array_length(v_player_ids, 1) LOOP
    IF v_player_ids[v_i] = p_player_id THEN
      v_current_idx := v_i - 1;
      EXIT;
    END IF;
  END LOOP;

  IF v_current_idx = -1 THEN
    RETURN jsonb_build_object('error', 'Игрок не найден в списке');
  END IF;

  v_next_idx := (v_current_idx + 1) % array_length(v_player_ids, 1);
  v_next_player_id := v_player_ids[v_next_idx + 1];

  -- Draw-фаза: добираем 1 карту ТОЛЬКО если рука < 5
  SELECT * INTO v_next_player FROM game_players
    WHERE game_id = p_game_id AND player_id = v_next_player_id
    FOR UPDATE;

  v_deck := COALESCE(v_next_player.deck_pile, '[]'::jsonb);
  v_hand := COALESCE(v_next_player.hand, '[]'::jsonb);

  IF jsonb_array_length(v_hand) < v_hand_limit AND jsonb_array_length(v_deck) > 0 THEN
    v_drawn_card := v_deck->(jsonb_array_length(v_deck) - 1);
    v_deck := (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
               FROM (
                 SELECT value
                 FROM jsonb_array_elements(v_deck) WITH ORDINALITY AS t(value, ord)
                 WHERE ord < jsonb_array_length(v_deck)
               ) sub);
    v_hand := v_hand || jsonb_build_array(v_drawn_card);
    v_drew_card := TRUE;

    UPDATE game_players SET
      hand = v_hand,
      deck_pile = v_deck,
      deck_remaining = jsonb_array_length(v_deck)
    WHERE game_id = p_game_id AND player_id = v_next_player_id;
  END IF;

  -- Обновляем игру
  v_new_version := COALESCE(v_game.version, 0) + 1;
  UPDATE games SET
    current_player_id = v_next_player_id,
    current_turn = COALESCE(v_game.current_turn, 0) + 1,
    version = v_new_version,
    updated_at = now()
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
$$;

GRANT EXECUTE ON FUNCTION public.end_turn(UUID, TEXT) TO anon, authenticated;
