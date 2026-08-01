-- play_card RPC (v1): атомарная постановка карты на землю + refill
-- Берёт карту из hand, кладёт в zone, добирает из deck_pile до STARTING_HAND_SIZE.
-- Использует SECURITY DEFINER + блокировку строк для атомарности.

CREATE OR REPLACE FUNCTION public.play_card(
  p_game_id UUID,
  p_player_id TEXT,
  p_card_index INT,
  p_zone_position INT
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
  v_zones JSONB;
  v_card JSONB;
  v_card_with_meta JSONB;
  v_new_hand JSONB;
  v_new_deck JSONB;
  v_new_version INT;
  v_zones_by_position JSONB;
  v_target_zone JSONB;
  v_hand_limit INT := 5;
  v_zone_max INT := 10;
BEGIN
  -- Блокируем игрока
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

  -- Достаём карту из руки
  v_card := v_hand->p_card_index;
  v_hand := (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
             FROM (
               SELECT value, ordinality
               FROM jsonb_array_elements(v_hand) WITH ORDINALITY
               WHERE ordinality <> p_card_index + 1
             ) sub);

  -- Получаем текущее состояние зоны
  SELECT COALESCE(cards, '[]'::jsonb) INTO v_target_zone
  FROM game_zones
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position;
  IF v_target_zone IS NULL THEN
    v_target_zone := '[]'::jsonb;
  END IF;

  IF jsonb_array_length(v_target_zone) >= v_zone_max THEN
    RETURN jsonb_build_object('error', 'Земля полная (макс 10 карт)');
  END IF;

  -- Добавляем карту в зону с метаданными
  v_card_with_meta := v_card || jsonb_build_object(
    'tapped', false,
    'flipped', false,
    'zone_position', p_zone_position
  );
  v_target_zone := v_target_zone || jsonb_build_array(v_card_with_meta);

  -- Refill: добираем пока рука < 5
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

  -- Блокируем игру для обновления version
  SELECT version INTO v_new_version FROM games WHERE id = p_game_id FOR UPDATE;
  IF v_new_version IS NULL THEN
    RETURN jsonb_build_object('error', 'Игра не найдена');
  END IF;

  -- Обновляем игрока
  UPDATE game_players SET
    hand = v_new_hand,
    deck_pile = v_new_deck,
    deck_remaining = jsonb_array_length(v_new_deck)
  WHERE game_id = p_game_id AND player_id = p_player_id;

  -- Обновляем зону
  UPDATE game_zones SET
    cards = v_target_zone,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position;

  -- Обновляем version игры
  UPDATE games SET
    version = v_new_version + 1,
    updated_at = now()
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version + 1,
    'hand_count', jsonb_array_length(v_new_hand),
    'deck_remaining', jsonb_array_length(v_new_deck),
    'card', v_card
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.play_card(UUID, TEXT, INT, INT) TO anon, authenticated;
