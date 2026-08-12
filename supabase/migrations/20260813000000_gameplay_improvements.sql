-- Gameplay improvements: card cost actions, manual draw, shuffle, hand discard, preset winrate

-- ── Preset decks: winrate + richer descriptions ──
ALTER TABLE public.preset_decks
  ADD COLUMN IF NOT EXISTS winrate numeric(5,2);

COMMENT ON COLUMN public.preset_decks.winrate IS
  'Win rate percentage (0–100) for display in deck picker';

-- Default winrates and descriptions for known hero decks
UPDATE public.preset_decks SET
  winrate = COALESCE(winrate, 52.0),
  description = COALESCE(
    NULLIF(TRIM(description), ''),
    format('Готовая колода героя %s — сбалансированный набор из 40 карт и 4 земель для быстрого старта.', name)
  )
WHERE is_active = true;

-- Populate landscapes JSONB from landscape cards in catalog when empty
UPDATE public.preset_decks pd SET landscapes = sub.lands
FROM (
  SELECT
    pd2.id AS deck_id,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('card_id', c.id, 'land_type', c.land_type, 'name', c.name)
        ORDER BY c.land_type
      ) FILTER (WHERE c.id IS NOT NULL),
      '[]'::jsonb
    ) AS lands
  FROM public.preset_decks pd2
  CROSS JOIN LATERAL (
    SELECT DISTINCT ON (c2.land_type) c2.id, c2.land_type, c2.name
    FROM public.cards c2
    WHERE c2.card_type = 'landscape'
      AND c2.land_type IS NOT NULL
      AND c2.land_type <> 'any'
    ORDER BY c2.land_type, c2.card_number
    LIMIT 4
  ) c
  WHERE jsonb_array_length(COALESCE(pd2.landscapes, '[]'::jsonb)) = 0
  GROUP BY pd2.id
) sub
WHERE pd.id = sub.deck_id
  AND jsonb_array_length(COALESCE(pd.landscapes, '[]'::jsonb)) = 0;

-- ── Turn draw tracking (once per turn, no accumulation) ──
ALTER TABLE public.game_players
  ADD COLUMN IF NOT EXISTS free_draw_used boolean NOT NULL DEFAULT false;

ALTER TABLE public.game_players
  ADD COLUMN IF NOT EXISTS paid_draw_used boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.game_players.free_draw_used IS
  'Бесплатный добор использован в текущем ходу';
COMMENT ON COLUMN public.game_players.paid_draw_used IS
  'Платный добор (−1 действие) использован в текущем ходу';

-- Helper: parse card cost from JSONB
CREATE OR REPLACE FUNCTION public._card_action_cost(p_card jsonb)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0, COALESCE(NULLIF(p_card->>'cost', '')::int, 1));
$$;

-- ── play_card: spend actions equal to card cost ──
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

-- ── Free draw: once per turn, no auto-draw on turn start ──
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

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'hand_count', jsonb_array_length(v_hand),
    'deck_remaining', jsonb_array_length(v_deck),
    'draw_type', 'free'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.draw_free_card(UUID, TEXT) TO anon, authenticated;

-- ── Paid draw: once per turn, costs 1 action ──
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

-- ── Shuffle: combine hand + deck, shuffle; recycle discard if deck would be empty ──
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

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'deck_remaining', jsonb_array_length(v_new_deck),
    'hand_count', 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.shuffle_deck(UUID, TEXT) TO anon, authenticated;

-- ── Discard card from hand ──
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

  RETURN jsonb_build_object(
    'success', TRUE,
    'version', v_new_version,
    'hand_count', jsonb_array_length(v_new_hand),
    'discard_count', jsonb_array_length(v_discard)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.discard_from_hand(UUID, TEXT, INT) TO anon, authenticated;

-- ── end_turn: keep battle phase, NO auto-draw; reset draw flags for next player ──
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

-- ── confirm_land_setup: first turn without auto-draw ──
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
END;
$function$;

-- ── get_player_game_state: expose draw flags ──
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
    'actions_remaining', (
      SELECT COALESCE(gp_cur.actions_remaining, 2)
      FROM public.game_players gp_cur
      WHERE gp_cur.game_id = g.id AND gp_cur.player_id = p_player_id
    ),
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
          'actions_remaining', COALESCE(gp.actions_remaining, 2),
          'free_draw_used', COALESCE(gp.free_draw_used, false),
          'paid_draw_used', COALESCE(gp.paid_draw_used, false),
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
