-- draw_free_card / draw_card_for_action: return full hand to RPC caller for optimistic UI.
-- Ably outbox payload stays observer-safe (hand_count only, no hand array).

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
        'draw_type', 'free',
        'free_draw_used', true
      )
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'hand', v_hand,
    'hand_count', jsonb_array_length(v_hand),
    'deck_remaining', jsonb_array_length(v_deck),
    'draw_type', 'free',
    'free_draw_used', true
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
        'actions_remaining', v_actions - 1,
        'paid_draw_used', true
      )
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'hand', v_hand,
    'hand_count', jsonb_array_length(v_hand),
    'deck_remaining', jsonb_array_length(v_deck),
    'actions_remaining', v_actions - 1,
    'draw_type', 'paid',
    'paid_draw_used', true
  );
END;
$$;
