-- Fix: confirm_land_setup делал второй UPDATE games без bump version →
-- validate_game_before_write: «Конфликт версий: ожидалось N, прислано N-1».
-- Также: триггер авто-инкрементирует version, если RPC обновил строку без смены version.

CREATE OR REPLACE FUNCTION public.validate_game_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  known_player_ids TEXT[];
BEGIN
  IF NEW.status IS NOT NULL AND NEW.status NOT IN ('setup', 'active', 'finished') THEN
    RAISE EXCEPTION 'Недопустимый status: %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'finished' AND NEW.winner_id IS NULL THEN
    RAISE EXCEPTION 'При status=finished нужно указать winner_id'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.current_player_id IS NOT NULL THEN
    SELECT array_agg(player_id) INTO known_player_ids
    FROM public.game_players
    WHERE game_id = NEW.id;

    IF known_player_ids IS NULL OR NOT (NEW.current_player_id = ANY(known_player_ids)) THEN
      RAISE EXCEPTION 'current_player_id (%) не найден среди игроков игры', NEW.current_player_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.version IS NULL THEN
      RAISE EXCEPTION 'version обязателен при UPDATE'
        USING ERRCODE = 'check_violation';
    END IF;
    -- RPC иногда обновляет только game_state; version не тронут → авто +1
    IF NEW.version = OLD.version THEN
      NEW.version := OLD.version + 1;
    ELSIF NEW.version <> OLD.version + 1 AND NEW.version <> 1 THEN
      RAISE EXCEPTION 'Конфликт версий: ожидалось %, прислано %', OLD.version + 1, NEW.version
        USING ERRCODE = 'serialization_failure';
    END IF;
    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := now();
    END IF;
  ELSE
    IF NEW.version IS NULL THEN
      NEW.version := 1;
    END IF;
    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_land_setup(p_game_id uuid, p_player_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_lobby_id uuid;
  v_first_player_id text;
  v_log jsonb;
  v_ready int;
  v_total int;
  v_deck jsonb;
  v_hand jsonb;
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

  -- Первый ход: бесплатная карта + 2 действия (до единственного UPDATE games)
  SELECT COALESCE(deck_pile, '[]'::jsonb), COALESCE(hand, '[]'::jsonb)
  INTO v_deck, v_hand
  FROM public.game_players
  WHERE game_id = p_game_id AND player_id = v_first_player_id
  FOR UPDATE;

  IF jsonb_array_length(v_deck) > 0 THEN
    v_hand := v_hand || jsonb_build_array(v_deck -> (jsonb_array_length(v_deck) - 1));
    v_deck := (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
               FROM (
                 SELECT value
                 FROM jsonb_array_elements(v_deck) WITH ORDINALITY AS t(value, ord)
                 WHERE ord < jsonb_array_length(v_deck)
               ) sub);
    v_log := v_log || jsonb_build_array(jsonb_build_object(
      'timestamp', (extract(epoch from now()) * 1000)::bigint,
      'message', 'Первый ход · +1 карта · 2 действия'
    ));
  END IF;

  UPDATE public.game_players SET
    hand = v_hand,
    deck_pile = v_deck,
    deck_remaining = jsonb_array_length(v_deck),
    actions_remaining = 2,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = v_first_player_id;

  UPDATE public.games
  SET
    status = 'active',
    current_player_id = v_first_player_id,
    game_state = jsonb_build_object(
      'status', 'active',
      'currentTurn', 0,
      'currentPlayerId', v_first_player_id,
      'turnPhase', 'main',
      'log', v_log
    ),
    version = version + 1,
    updated_at = now()
  WHERE id = p_game_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
