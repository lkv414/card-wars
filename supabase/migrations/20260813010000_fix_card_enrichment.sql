-- Восстановление полных данных карт (name, image_url, cost…) при чтении состояния игры.

CREATE OR REPLACE FUNCTION public.enrich_card_jsonb(p_card jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_card IS NULL THEN NULL
    WHEN jsonb_typeof(p_card) = 'string' THEN (
      SELECT COALESCE(to_jsonb(c), jsonb_build_object('id', p_card #>> '{}'))
      FROM public.cards c
      WHERE c.id::text = p_card #>> '{}'
      LIMIT 1
    )
    WHEN jsonb_typeof(p_card) <> 'object' THEN p_card
    ELSE COALESCE(
      (
        SELECT to_jsonb(c) || p_card
        FROM public.cards c
        WHERE c.id::text = COALESCE(p_card->>'id', p_card->>'card_id')
        LIMIT 1
      ),
      p_card
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.enrich_card_array(p_cards jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(public.enrich_card_jsonb(elem) ORDER BY ord),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(p_cards, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord);
$$;

CREATE OR REPLACE FUNCTION public.get_player_game_state(p_game_id uuid, p_player_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
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
          'hand', CASE
            WHEN gp.player_id = p_player_id THEN public.enrich_card_array(gp.hand)
            ELSE '[]'::jsonb
          END,
          'deck_pile', CASE
            WHEN gp.player_id = p_player_id THEN public.enrich_card_array(gp.deck_pile)
            ELSE '[]'::jsonb
          END,
          'discard_pile', CASE
            WHEN gp.player_id = p_player_id THEN public.enrich_card_array(COALESCE(gp.discard_pile, '[]'::jsonb))
            ELSE '[]'::jsonb
          END,
          'deck_remaining', gp.deck_remaining,
          'hand_count', jsonb_array_length(gp.hand),
          'deck_pile_count', jsonb_array_length(gp.deck_pile),
          'discard_count', jsonb_array_length(COALESCE(gp.discard_pile, '[]'::jsonb)),
          'zones', (
            SELECT coalesce(jsonb_agg(zobj ORDER BY (zobj->>'zone_position')::int), '[]'::jsonb)
            FROM (
              SELECT jsonb_build_object(
                'zone_position', gz.zone_position,
                'cards', public.enrich_card_array(COALESCE(gz.cards, '[]'::jsonb)),
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

-- confirm_land_setup: не затирать firstPlayerId и прочие поля game_state
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
  v_game_state jsonb;
BEGIN
  SELECT g.lobby_id, g.game_state->'log', g.game_state->>'firstPlayerId', g.game_state
  INTO v_lobby_id, v_log, v_first_player_id, v_game_state
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
    game_state = coalesce(v_game_state, '{}'::jsonb) || jsonb_build_object(
      'status', 'active',
      'currentTurn', 0,
      'currentPlayerId', v_first_player_id,
      'firstPlayerId', v_first_player_id,
      'turnPhase', 'main',
      'log', v_log || jsonb_build_array(jsonb_build_object(
        'timestamp', (extract(epoch from now()) * 1000)::bigint,
        'message', 'Первый ход · возьми бесплатную карту кнопкой · 2 действия'
      ))
    ),
    version = version + 1
  WHERE id = p_game_id;

  UPDATE public.game_players SET
    actions_remaining = 2,
    free_draw_used = false,
    paid_draw_used = false,
    updated_at = now()
  WHERE game_id = p_game_id AND player_id = v_first_player_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
