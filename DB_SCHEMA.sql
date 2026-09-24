-- ============================================================
-- DB_SCHEMA.sql — полная актуальная схема card_game (после Фаз 1–6)
-- Сгенерировано из БД <supabase-project> автоматически.
-- Применяется через Supabase SQL Editor / Management API / psql.
-- Идемпотентный: можно запускать многократно (CREATE IF NOT EXISTS,
-- DROP IF EXISTS для триггеров/функций/политик).
-- ============================================================

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cards (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    card_number integer NOT NULL,
    name text NOT NULL,
    description text,
    card_type text NOT NULL,
    cost integer NOT NULL DEFAULT 1,
    attack integer,
    health integer,
    has_flip boolean DEFAULT false,
    flip_description text,
    mechanics jsonb NOT NULL DEFAULT '[]'::jsonb,
    mechanics_version smallint NOT NULL DEFAULT 1,
    mechanics_status text NOT NULL DEFAULT 'unreviewed',
    image_url text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    land_type text DEFAULT 'any',
    is_rainbow boolean DEFAULT false,
    CONSTRAINT cards_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.decks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    name text NOT NULL DEFAULT 'Моя колода',
    code text NOT NULL,
    cards jsonb NOT NULL DEFAULT '[]',
    lands jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT decks_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.game_chat (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    game_id uuid NOT NULL,
    player_id text NOT NULL,
    message text NOT NULL,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT game_chat_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.game_players (
    game_id uuid NOT NULL,
    player_id text NOT NULL,
    health integer DEFAULT 25,
    hand jsonb DEFAULT '[]',
    deck_remaining integer DEFAULT 35,
    position text NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    nickname text,
    player_order smallint NOT NULL DEFAULT 1,
    last_seen timestamptz,
    deck_pile jsonb DEFAULT '[]',
    CONSTRAINT game_players_pkey PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS public.game_zones (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    game_id uuid NOT NULL,
    zone_position integer NOT NULL,
    player_id text NOT NULL,
    cards jsonb DEFAULT '[]',
    land_id uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT game_zones_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.games (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    lobby_id uuid,
    status text DEFAULT 'setup',
    current_turn integer DEFAULT 0,
    current_player_id text,
    game_state jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    winner_id text,
    started_at timestamptz,
    ended_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    turn_started_at timestamptz,
    CONSTRAINT games_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.lands (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    land_type text NOT NULL,
    description text,
    image_url text,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT lands_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.lobbies (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    code text NOT NULL,
    host_id text NOT NULL,
    status text DEFAULT 'waiting',
    deck_host jsonb,
    deck_guest jsonb,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT lobbies_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.lobby_players (
    lobby_id uuid NOT NULL,
    player_id text NOT NULL,
    deck jsonb,
    ready boolean DEFAULT false,
    joined_at timestamptz DEFAULT now(),
    nickname text,
    CONSTRAINT lobby_players_pkey PRIMARY KEY (lobby_id, player_id)
);

-- ============================================================
-- 2. CONSTRAINTS (FK, UNIQUE, CHECK)
-- ============================================================

-- CHECK constraint 2200_17648_1_not_null on cards (None) — нужно достать определение из БД

-- CHECK constraint 2200_17648_2_not_null on cards (None) — нужно достать определение из БД

-- CHECK constraint 2200_17648_3_not_null on cards (None) — нужно достать определение из БД

-- CHECK constraint 2200_17648_5_not_null on cards (None) — нужно достать определение из БД

-- CHECK constraint 2200_17648_6_not_null on cards (None) — нужно достать определение из БД

-- CHECK constraint cards_card_type_check on cards (None) — нужно достать определение из БД

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_card_number_key;
ALTER TABLE public.cards ADD CONSTRAINT cards_card_number_key UNIQUE (card_number);

-- CHECK constraint 2200_17679_1_not_null on decks (None) — нужно достать определение из БД

-- CHECK constraint 2200_17679_2_not_null on decks (None) — нужно достать определение из БД

-- CHECK constraint 2200_17679_3_not_null on decks (None) — нужно достать определение из БД

-- CHECK constraint 2200_17679_4_not_null on decks (None) — нужно достать определение из БД

-- CHECK constraint 2200_17679_5_not_null on decks (None) — нужно достать определение из БД

-- CHECK constraint 2200_17679_6_not_null on decks (None) — нужно достать определение из БД

ALTER TABLE public.decks DROP CONSTRAINT IF EXISTS decks_code_key;
ALTER TABLE public.decks ADD CONSTRAINT decks_code_key UNIQUE (code);

-- CHECK constraint 2200_18850_1_not_null on game_chat (None) — нужно достать определение из БД

-- CHECK constraint 2200_18850_2_not_null on game_chat (None) — нужно достать определение из БД

-- CHECK constraint 2200_18850_3_not_null on game_chat (None) — нужно достать определение из БД

-- CHECK constraint 2200_18850_4_not_null on game_chat (None) — нужно достать определение из БД

ALTER TABLE public.game_chat DROP CONSTRAINT IF EXISTS game_chat_game_id_fkey;
ALTER TABLE public.game_chat ADD CONSTRAINT game_chat_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);

-- CHECK constraint 2200_18821_10_not_null on game_players (None) — нужно достать определение из БД

-- CHECK constraint 2200_18821_1_not_null on game_players (None) — нужно достать определение из БД

-- CHECK constraint 2200_18821_2_not_null on game_players (None) — нужно достать определение из БД

-- CHECK constraint 2200_18821_6_not_null on game_players (None) — нужно достать определение из БД

-- CHECK constraint game_players_player_order_check on game_players (None) — нужно достать определение из БД

-- CHECK constraint game_players_position_check on game_players (None) — нужно достать определение из БД

ALTER TABLE public.game_players DROP CONSTRAINT IF EXISTS game_players_game_id_fkey;
ALTER TABLE public.game_players ADD CONSTRAINT game_players_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);

-- CHECK constraint 2200_18836_1_not_null on game_zones (None) — нужно достать определение из БД

-- CHECK constraint 2200_18836_2_not_null on game_zones (None) — нужно достать определение из БД

-- CHECK constraint 2200_18836_3_not_null on game_zones (None) — нужно достать определение из БД

-- CHECK constraint 2200_18836_4_not_null on game_zones (None) — нужно достать определение из БД

-- CHECK constraint game_zones_zone_position_check on game_zones (None) — нужно достать определение из БД

ALTER TABLE public.game_zones DROP CONSTRAINT IF EXISTS game_zones_game_id_fkey;
ALTER TABLE public.game_zones ADD CONSTRAINT game_zones_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);

ALTER TABLE public.game_zones DROP CONSTRAINT IF EXISTS game_zones_game_unique;
ALTER TABLE public.game_zones ADD CONSTRAINT game_zones_game_unique UNIQUE (game_id, zone_position, player_id);

ALTER TABLE public.game_zones DROP CONSTRAINT IF EXISTS game_zones_game_unique;
ALTER TABLE public.game_zones ADD CONSTRAINT game_zones_game_unique UNIQUE (game_id, zone_position, player_id);

ALTER TABLE public.game_zones DROP CONSTRAINT IF EXISTS game_zones_game_unique;
ALTER TABLE public.game_zones ADD CONSTRAINT game_zones_game_unique UNIQUE (game_id, zone_position, player_id);

-- CHECK constraint 2200_18804_12_not_null on games (None) — нужно достать определение из БД

-- CHECK constraint 2200_18804_1_not_null on games (None) — нужно достать определение из БД

-- CHECK constraint games_status_check on games (None) — нужно достать определение из БД

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_lobby_id_fkey;
ALTER TABLE public.games ADD CONSTRAINT games_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id);

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_lobby_id_key;
ALTER TABLE public.games ADD CONSTRAINT games_lobby_id_key UNIQUE (lobby_id);

-- CHECK constraint 2200_17668_1_not_null on lands (None) — нужно достать определение из БД

-- CHECK constraint 2200_17668_2_not_null on lands (None) — нужно достать определение из БД

-- CHECK constraint 2200_17668_3_not_null on lands (None) — нужно достать определение из БД

ALTER TABLE public.lands DROP CONSTRAINT IF EXISTS lands_land_type_key;
ALTER TABLE public.lands ADD CONSTRAINT lands_land_type_key UNIQUE (land_type);

-- CHECK constraint 2200_18315_1_not_null on lobbies (None) — нужно достать определение из БД

-- CHECK constraint 2200_18315_2_not_null on lobbies (None) — нужно достать определение из БД

-- CHECK constraint 2200_18315_3_not_null on lobbies (None) — нужно достать определение из БД

ALTER TABLE public.lobbies DROP CONSTRAINT IF EXISTS lobbies_code_key;
ALTER TABLE public.lobbies ADD CONSTRAINT lobbies_code_key UNIQUE (code);

-- CHECK constraint 2200_18327_1_not_null on lobby_players (None) — нужно достать определение из БД

-- CHECK constraint 2200_18327_2_not_null on lobby_players (None) — нужно достать определение из БД

ALTER TABLE public.lobby_players DROP CONSTRAINT IF EXISTS lobby_players_lobby_id_fkey;
ALTER TABLE public.lobby_players ADD CONSTRAINT lobby_players_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id);

-- ============================================================
-- 3. FUNCTIONS
-- ============================================================

DROP FUNCTION IF EXISTS public.find_similar_cards CASCADE;
CREATE OR REPLACE FUNCTION public.find_similar_cards(p_name text, p_description text)
 RETURNS TABLE(id uuid, card_number integer, name text, description text, similarity_score double precision)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.card_number,
    c.name,
    c.description,
    GREATEST(
      similarity(c.name, p_name),
      COALESCE(similarity(c.description, p_description), 0)
    ) as similarity_score
  FROM cards c
  WHERE similarity(c.name, p_name) > 0.3 
     OR similarity(c.description, p_description) > 0.3
  ORDER BY similarity_score DESC
  LIMIT 5;
END;
$function$
;

DROP FUNCTION IF EXISTS public.get_player_game_state CASCADE;
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
  IF lobby_uuid IS NULL THEN
    RETURN NULL;
  END IF;

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
    'version', g.version,
    'started_at', g.started_at,
    'ended_at', g.ended_at,
    'players', (
      SELECT coalesce(jsonb_agg(player_obj), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'id', gp.player_id,
          'player_id', gp.player_id,
          'nickname', gp.nickname,
          'position', gp.position,
          'health', gp.health,
          'player_order', gp.player_order,
          'is_self', gp.player_id = p_player_id,
          'hand', CASE WHEN gp.player_id = p_player_id THEN gp.hand ELSE '[]'::jsonb END,
          'deck_pile', CASE WHEN gp.player_id = p_player_id THEN gp.deck_pile ELSE '[]'::jsonb END,
          'deck_remaining', gp.deck_remaining,
          'hand_count', jsonb_array_length(gp.hand),
          'deck_pile_count', jsonb_array_length(gp.deck_pile),
          'zones', (
            SELECT coalesce(jsonb_agg(zobj), '[]'::jsonb)
            FROM (
              SELECT jsonb_build_object(
                'zone_position', gz.zone_position,
                'cards', gz.cards,
                'land_id', gz.land_id
              ) AS zobj
              FROM public.game_zones gz
              WHERE gz.game_id = gp.game_id AND gz.player_id = gp.player_id
              ORDER BY gz.zone_position
            ) z
          )
        ) AS player_obj
        FROM public.game_players gp
        WHERE gp.game_id = g.id
        ORDER BY gp.player_order
      ) players_subq
    )
  ) INTO result
  FROM public.games g
  WHERE g.id = p_game_id;

  RETURN result;
END;
$function$
;

DROP FUNCTION IF EXISTS public.gin_extract_query_trgm CASCADE;
CREATE OR REPLACE FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_query_trgm$function$
;

DROP FUNCTION IF EXISTS public.gin_extract_value_trgm CASCADE;
CREATE OR REPLACE FUNCTION public.gin_extract_value_trgm(text, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_value_trgm$function$
;

DROP FUNCTION IF EXISTS public.gin_trgm_consistent CASCADE;
CREATE OR REPLACE FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_consistent$function$
;

DROP FUNCTION IF EXISTS public.gin_trgm_triconsistent CASCADE;
CREATE OR REPLACE FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal)
 RETURNS "char"
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_triconsistent$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_compress CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_compress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_compress$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_consistent CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_consistent$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_decompress CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_decompress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_decompress$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_distance CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_distance$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_in CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_in(cstring)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_in$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_options CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_options(internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/pg_trgm', $function$gtrgm_options$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_out CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_out(gtrgm)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_out$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_penalty CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_penalty(internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_penalty$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_picksplit CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_picksplit(internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_picksplit$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_same CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_same(gtrgm, gtrgm, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_same$function$
;

DROP FUNCTION IF EXISTS public.gtrgm_union CASCADE;
CREATE OR REPLACE FUNCTION public.gtrgm_union(internal, internal)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_union$function$
;

DROP FUNCTION IF EXISTS public.is_lobby_member CASCADE;
CREATE OR REPLACE FUNCTION public.is_lobby_member(p_lobby_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.lobby_players lp
    WHERE lp.lobby_id = p_lobby_id
    AND lp.player_id = current_setting('app.guest_id', true)
  );
$function$
;

DROP FUNCTION IF EXISTS public.set_guest_id CASCADE;
CREATE OR REPLACE FUNCTION public.set_guest_id(p_guest_id text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  PERFORM set_config('app.guest_id', p_guest_id, true);
END;
$function$
;

DROP FUNCTION IF EXISTS public.set_limit CASCADE;
CREATE OR REPLACE FUNCTION public.set_limit(real)
 RETURNS real
 LANGUAGE c
 STRICT
AS '$libdir/pg_trgm', $function$set_limit$function$
;

DROP FUNCTION IF EXISTS public.show_limit CASCADE;
CREATE OR REPLACE FUNCTION public.show_limit()
 RETURNS real
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_limit$function$
;

DROP FUNCTION IF EXISTS public.show_trgm CASCADE;
CREATE OR REPLACE FUNCTION public.show_trgm(text)
 RETURNS text[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_trgm$function$
;

DROP FUNCTION IF EXISTS public.similarity CASCADE;
CREATE OR REPLACE FUNCTION public.similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity$function$
;

DROP FUNCTION IF EXISTS public.similarity_dist CASCADE;
CREATE OR REPLACE FUNCTION public.similarity_dist(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_dist$function$
;

DROP FUNCTION IF EXISTS public.similarity_op CASCADE;
CREATE OR REPLACE FUNCTION public.similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_op$function$
;

DROP FUNCTION IF EXISTS public.strict_word_similarity CASCADE;
CREATE OR REPLACE FUNCTION public.strict_word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity$function$
;

DROP FUNCTION IF EXISTS public.strict_word_similarity_commutator_op CASCADE;
CREATE OR REPLACE FUNCTION public.strict_word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_commutator_op$function$
;

DROP FUNCTION IF EXISTS public.strict_word_similarity_dist_commutator_op CASCADE;
CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_commutator_op$function$
;

DROP FUNCTION IF EXISTS public.strict_word_similarity_dist_op CASCADE;
CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_op$function$
;

DROP FUNCTION IF EXISTS public.strict_word_similarity_op CASCADE;
CREATE OR REPLACE FUNCTION public.strict_word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_op$function$
;

DROP FUNCTION IF EXISTS public.validate_game_before_write CASCADE;
CREATE OR REPLACE FUNCTION public.validate_game_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  known_player_ids TEXT[];
BEGIN
  -- status должен быть в фиксированном наборе
  IF NEW.status IS NOT NULL AND NEW.status NOT IN ('setup', 'active', 'finished') THEN
    RAISE EXCEPTION 'Недопустимый status: %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- winner_id обязателен при status='finished'
  IF NEW.status = 'finished' AND NEW.winner_id IS NULL THEN
    RAISE EXCEPTION 'При status=finished нужно указать winner_id'
      USING ERRCODE = 'check_violation';
  END IF;

  -- current_player_id должен быть среди игроков этой игры
  IF NEW.current_player_id IS NOT NULL THEN
    SELECT array_agg(player_id) INTO known_player_ids
    FROM public.game_players
    WHERE game_id = NEW.id;

    IF known_player_ids IS NULL OR NOT (NEW.current_player_id = ANY(known_player_ids)) THEN
      RAISE EXCEPTION 'current_player_id (%) не найден среди игроков игры', NEW.current_player_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- version: optimistic lock
  IF TG_OP = 'UPDATE' THEN
    -- Клиент обязан прислать version = OLD.version + 1 (или = 1 при первом UPDATE)
    IF NEW.version IS NULL THEN
      RAISE EXCEPTION 'version обязателен при UPDATE'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.version IS NOT NULL AND NEW.version <> OLD.version + 1 AND NEW.version <> 1 THEN
      RAISE EXCEPTION 'Конфликт версий: ожидалось %, прислано %', OLD.version + 1, NEW.version
        USING ERRCODE = 'serialization_failure';
    END IF;
    -- Авто-инкремент updated_at, если клиент не прислал
    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := now();
    END IF;
  ELSE
    -- INSERT: version = 1 по умолчанию
    IF NEW.version IS NULL THEN
      NEW.version := 1;
    END IF;
    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

DROP FUNCTION IF EXISTS public.validate_game_player_before_write CASCADE;
CREATE OR REPLACE FUNCTION public.validate_game_player_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  starting_hand CONSTANT INTEGER := 5;
  max_health CONSTANT INTEGER := 25;
  hand_len INTEGER;
  pile_len INTEGER;
BEGIN
  -- hand — массив, длина ≤ STARTING_HAND_SIZE
  IF NEW.hand IS NOT NULL THEN
    IF jsonb_typeof(NEW.hand) <> 'array' THEN
      RAISE EXCEPTION 'hand должен быть JSON-массивом'
        USING ERRCODE = 'datatype_mismatch';
    END IF;
    hand_len := jsonb_array_length(NEW.hand);
    IF hand_len > starting_hand THEN
      RAISE EXCEPTION 'В руке не может быть больше % карт (получено %)', starting_hand, hand_len
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- deck_pile — массив
  IF NEW.deck_pile IS NOT NULL THEN
    IF jsonb_typeof(NEW.deck_pile) <> 'array' THEN
      RAISE EXCEPTION 'deck_pile должен быть JSON-массивом'
        USING ERRCODE = 'datatype_mismatch';
    END IF;
    pile_len := jsonb_array_length(NEW.deck_pile);
  END IF;

  -- deck_remaining должен соответствовать длине deck_pile
  IF NEW.deck_remaining IS NOT NULL AND pile_len IS NOT NULL THEN
    IF NEW.deck_remaining <> pile_len THEN
      -- Мягкая коррекция: deck_pile — источник правды
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
$function$
;

DROP FUNCTION IF EXISTS public.validate_game_zone_before_write CASCADE;
CREATE OR REPLACE FUNCTION public.validate_game_zone_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.zone_position IS NOT NULL THEN
    IF NEW.zone_position < 1 OR NEW.zone_position > 4 THEN
      RAISE EXCEPTION 'zone_position должен быть в [1..4], получено %', NEW.zone_position
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.cards IS NOT NULL THEN
    IF jsonb_typeof(NEW.cards) <> 'array' THEN
      RAISE EXCEPTION 'cards должен быть JSON-массивом'
        USING ERRCODE = 'datatype_mismatch';
    END IF;
    IF jsonb_array_length(NEW.cards) > 10 THEN
      RAISE EXCEPTION 'В зоне не может быть больше 10 карт'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

DROP FUNCTION IF EXISTS public.word_similarity CASCADE;
CREATE OR REPLACE FUNCTION public.word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity$function$
;

DROP FUNCTION IF EXISTS public.word_similarity_commutator_op CASCADE;
CREATE OR REPLACE FUNCTION public.word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_commutator_op$function$
;

DROP FUNCTION IF EXISTS public.word_similarity_dist_commutator_op CASCADE;
CREATE OR REPLACE FUNCTION public.word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_commutator_op$function$
;

DROP FUNCTION IF EXISTS public.word_similarity_dist_op CASCADE;
CREATE OR REPLACE FUNCTION public.word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_op$function$
;

DROP FUNCTION IF EXISTS public.word_similarity_op CASCADE;
CREATE OR REPLACE FUNCTION public.word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_op$function$
;

-- ============================================================
-- 4. TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS game_players_validate ON public.game_players;
CREATE TRIGGER game_players_validate
  BEFORE INSERT ON public.game_players
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_player_before_write();

DROP TRIGGER IF EXISTS game_players_validate ON public.game_players;
CREATE TRIGGER game_players_validate
  BEFORE UPDATE ON public.game_players
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_player_before_write();

DROP TRIGGER IF EXISTS game_zones_validate ON public.game_zones;
CREATE TRIGGER game_zones_validate
  BEFORE INSERT ON public.game_zones
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_zone_before_write();

DROP TRIGGER IF EXISTS game_zones_validate ON public.game_zones;
CREATE TRIGGER game_zones_validate
  BEFORE UPDATE ON public.game_zones
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_zone_before_write();

DROP TRIGGER IF EXISTS games_validate ON public.games;
CREATE TRIGGER games_validate
  BEFORE INSERT ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_before_write();

DROP TRIGGER IF EXISTS games_validate ON public.games;
CREATE TRIGGER games_validate
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_before_write();

-- ============================================================
-- 5. RLS POLICIES
-- ============================================================

ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobby_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_players_insert ON public.game_players;
CREATE POLICY game_players_insert ON public.game_players
  FOR INSERT
  WITH CHECK (((player_id = current_setting('app.guest_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_players.game_id) AND is_lobby_member(g.lobby_id))))))
;
DROP POLICY IF EXISTS game_players_realtime_bypass ON public.game_players;
CREATE POLICY game_players_realtime_bypass ON public.game_players
  FOR SELECT
  USING (true)
;
DROP POLICY IF EXISTS game_players_select ON public.game_players;
CREATE POLICY game_players_select ON public.game_players
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_players.game_id) AND is_lobby_member(g.lobby_id)))))
;
DROP POLICY IF EXISTS game_players_update ON public.game_players;
CREATE POLICY game_players_update ON public.game_players
  FOR UPDATE
  USING (((player_id = current_setting('app.guest_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_players.game_id) AND is_lobby_member(g.lobby_id))))))
;
DROP POLICY IF EXISTS game_zones_insert ON public.game_zones;
CREATE POLICY game_zones_insert ON public.game_zones
  FOR INSERT
  WITH CHECK (((player_id = current_setting('app.guest_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_zones.game_id) AND is_lobby_member(g.lobby_id))))))
;
DROP POLICY IF EXISTS game_zones_realtime_bypass ON public.game_zones;
CREATE POLICY game_zones_realtime_bypass ON public.game_zones
  FOR SELECT
  USING (true)
;
DROP POLICY IF EXISTS game_zones_select ON public.game_zones;
CREATE POLICY game_zones_select ON public.game_zones
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_zones.game_id) AND is_lobby_member(g.lobby_id)))))
;
DROP POLICY IF EXISTS game_zones_update ON public.game_zones;
CREATE POLICY game_zones_update ON public.game_zones
  FOR UPDATE
  USING (((player_id = current_setting('app.guest_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_zones.game_id) AND is_lobby_member(g.lobby_id))))))
;
DROP POLICY IF EXISTS games_delete ON public.games;
CREATE POLICY games_delete ON public.games
  FOR DELETE
  USING (is_lobby_member(lobby_id))
;
DROP POLICY IF EXISTS games_insert ON public.games;
CREATE POLICY games_insert ON public.games
  FOR INSERT
  WITH CHECK (is_lobby_member(lobby_id))
;
DROP POLICY IF EXISTS games_realtime_bypass ON public.games;
CREATE POLICY games_realtime_bypass ON public.games
  FOR SELECT
  USING (true)
;
DROP POLICY IF EXISTS games_select ON public.games;
CREATE POLICY games_select ON public.games
  FOR SELECT
  USING (is_lobby_member(lobby_id))
;
DROP POLICY IF EXISTS games_update ON public.games;
CREATE POLICY games_update ON public.games
  FOR UPDATE
  USING (is_lobby_member(lobby_id))
;
DROP POLICY IF EXISTS lobbies_delete ON public.lobbies;
CREATE POLICY lobbies_delete ON public.lobbies
  FOR DELETE
  USING ((host_id = current_setting('app.guest_id'::text, true)))
;
DROP POLICY IF EXISTS lobbies_insert ON public.lobbies;
CREATE POLICY lobbies_insert ON public.lobbies
  FOR INSERT
  WITH CHECK (true)
;
DROP POLICY IF EXISTS lobbies_select ON public.lobbies;
CREATE POLICY lobbies_select ON public.lobbies
  FOR SELECT
  USING (true)
;
DROP POLICY IF EXISTS lobbies_update ON public.lobbies;
CREATE POLICY lobbies_update ON public.lobbies
  FOR UPDATE
  USING ((host_id = current_setting('app.guest_id'::text, true)))
;
DROP POLICY IF EXISTS lobby_players_delete ON public.lobby_players;
CREATE POLICY lobby_players_delete ON public.lobby_players
  FOR DELETE
  USING ((player_id = current_setting('app.guest_id'::text, true)))
;
DROP POLICY IF EXISTS lobby_players_insert ON public.lobby_players;
CREATE POLICY lobby_players_insert ON public.lobby_players
  FOR INSERT
  WITH CHECK ((player_id = current_setting('app.guest_id'::text, true)))
;
DROP POLICY IF EXISTS lobby_players_realtime_bypass ON public.lobby_players;
CREATE POLICY lobby_players_realtime_bypass ON public.lobby_players
  FOR SELECT
  USING (true)
;
DROP POLICY IF EXISTS lobby_players_select ON public.lobby_players;
CREATE POLICY lobby_players_select ON public.lobby_players
  FOR SELECT
  USING (((player_id = current_setting('app.guest_id'::text, true)) OR is_lobby_member(lobby_id)))
;
DROP POLICY IF EXISTS lobby_players_update ON public.lobby_players;
CREATE POLICY lobby_players_update ON public.lobby_players
  FOR UPDATE
  USING ((player_id = current_setting('app.guest_id'::text, true)))
;
-- ============================================================
-- 6. REALTIME PUBLICATION
-- ============================================================

-- Таблицы в supabase_realtime (для postgres_changes подписок):
--   games, game_players, game_zones, lobbies, lobby_players, game_chat
-- (Supabase автоматически создаёт publication при первом добавлении
-- таблицы через dashboard или SQL).
-- Если нужно пересоздать вручную:
--   DROP PUBLICATION IF EXISTS supabase_realtime;
--   CREATE PUBLICATION supabase_realtime FOR TABLE
--     public.games, public.game_players, public.game_zones,
--     public.lobbies, public.lobby_players, public.game_chat;

-- ============================================================
-- 7. GRANTS
-- ============================================================

GRANT EXECUTE ON FUNCTION public.set_guest_id(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_lobby_member(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_game_state(uuid, text) TO anon, authenticated;
