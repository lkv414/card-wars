--
-- PostgreSQL database dump
--

\restrict 8sXZIQm2CwGafVdx7PcDJR6GfmdV0q1ufyb68QFDOcrDYHrRDwK8KVHluny86zI

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: gtrgm; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gtrgm;


--
-- Name: find_similar_cards(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_similar_cards(p_name text, p_description text) RETURNS TABLE(id uuid, card_number integer, name text, description text, similarity_score double precision)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: get_player_game_state(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_player_game_state(p_game_id uuid, p_player_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
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
$$;


--
-- Name: gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal) RETURNS internal
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gin_extract_query_trgm';


--
-- Name: gin_extract_value_trgm(text, internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gin_extract_value_trgm(text, internal) RETURNS internal
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gin_extract_value_trgm';


--
-- Name: gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal) RETURNS boolean
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gin_trgm_consistent';


--
-- Name: gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal) RETURNS "char"
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gin_trgm_triconsistent';


--
-- Name: gtrgm_compress(internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_compress(internal) RETURNS internal
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_compress';


--
-- Name: gtrgm_consistent(internal, text, smallint, oid, internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal) RETURNS boolean
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_consistent';


--
-- Name: gtrgm_decompress(internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_decompress(internal) RETURNS internal
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_decompress';


--
-- Name: gtrgm_distance(internal, text, smallint, oid, internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal) RETURNS double precision
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_distance';


--
-- Name: gtrgm_in(cstring); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_in(cstring) RETURNS public.gtrgm
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_in';


--
-- Name: gtrgm_options(internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_options(internal) RETURNS void
    LANGUAGE c IMMUTABLE PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_options';


--
-- Name: gtrgm_out(public.gtrgm); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_out(public.gtrgm) RETURNS cstring
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_out';


--
-- Name: gtrgm_penalty(internal, internal, internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_penalty(internal, internal, internal) RETURNS internal
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_penalty';


--
-- Name: gtrgm_picksplit(internal, internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_picksplit(internal, internal) RETURNS internal
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_picksplit';


--
-- Name: gtrgm_same(public.gtrgm, public.gtrgm, internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_same(public.gtrgm, public.gtrgm, internal) RETURNS internal
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_same';


--
-- Name: gtrgm_union(internal, internal); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtrgm_union(internal, internal) RETURNS public.gtrgm
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'gtrgm_union';


--
-- Name: is_lobby_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_lobby_member(p_lobby_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lobby_players lp
    WHERE lp.lobby_id = p_lobby_id
    AND lp.player_id = current_setting('app.guest_id', true)
  );
$$;


--
-- Name: set_guest_id(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_guest_id(p_guest_id text) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
  PERFORM set_config('app.guest_id', p_guest_id, true);
END;
$$;


--
-- Name: set_limit(real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_limit(real) RETURNS real
    LANGUAGE c STRICT
    AS '$libdir/pg_trgm', 'set_limit';


--
-- Name: show_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.show_limit() RETURNS real
    LANGUAGE c STABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'show_limit';


--
-- Name: show_trgm(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.show_trgm(text) RETURNS text[]
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'show_trgm';


--
-- Name: similarity(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.similarity(text, text) RETURNS real
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'similarity';


--
-- Name: similarity_dist(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.similarity_dist(text, text) RETURNS real
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'similarity_dist';


--
-- Name: similarity_op(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.similarity_op(text, text) RETURNS boolean
    LANGUAGE c STABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'similarity_op';


--
-- Name: strict_word_similarity(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.strict_word_similarity(text, text) RETURNS real
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'strict_word_similarity';


--
-- Name: strict_word_similarity_commutator_op(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.strict_word_similarity_commutator_op(text, text) RETURNS boolean
    LANGUAGE c STABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'strict_word_similarity_commutator_op';


--
-- Name: strict_word_similarity_dist_commutator_op(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.strict_word_similarity_dist_commutator_op(text, text) RETURNS real
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'strict_word_similarity_dist_commutator_op';


--
-- Name: strict_word_similarity_dist_op(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.strict_word_similarity_dist_op(text, text) RETURNS real
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'strict_word_similarity_dist_op';


--
-- Name: strict_word_similarity_op(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.strict_word_similarity_op(text, text) RETURNS boolean
    LANGUAGE c STABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'strict_word_similarity_op';


--
-- Name: validate_game_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_game_before_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: validate_game_player_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_game_player_before_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: validate_game_zone_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_game_zone_before_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: word_similarity(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.word_similarity(text, text) RETURNS real
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'word_similarity';


--
-- Name: word_similarity_commutator_op(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.word_similarity_commutator_op(text, text) RETURNS boolean
    LANGUAGE c STABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'word_similarity_commutator_op';


--
-- Name: word_similarity_dist_commutator_op(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.word_similarity_dist_commutator_op(text, text) RETURNS real
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'word_similarity_dist_commutator_op';


--
-- Name: word_similarity_dist_op(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.word_similarity_dist_op(text, text) RETURNS real
    LANGUAGE c IMMUTABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'word_similarity_dist_op';


--
-- Name: word_similarity_op(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.word_similarity_op(text, text) RETURNS boolean
    LANGUAGE c STABLE STRICT PARALLEL SAFE
    AS '$libdir/pg_trgm', 'word_similarity_op';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Heroes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Heroes" (
    hero_number text NOT NULL,
    name text NOT NULL,
    description text,
    card_type text NOT NULL,
    cost text,
    attack integer,
    health integer,
    has_flip boolean DEFAULT false,
    flip_description text,
    mechanics jsonb DEFAULT '[]'::jsonb,
    script text,
    image_url text,
    rarity text,
    hero_slug text,
    land_type text DEFAULT 'any'::text,
    is_rainbow boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    id text
);


--
-- Name: card_art; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_art (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    card_id uuid,
    source_url text,
    source_kind text,
    is_primary boolean DEFAULT false,
    variant text,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    card_number integer NOT NULL,
    name text NOT NULL,
    description text,
    card_type text NOT NULL,
    cost integer DEFAULT 1 NOT NULL,
    attack integer,
    health integer,
    has_flip boolean DEFAULT false,
    flip_description text,
    mechanics jsonb DEFAULT '[]'::jsonb,
    image_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    land_type text DEFAULT 'any'::text,
    is_rainbow boolean DEFAULT false,
    rarity text,
    source text,
    hero text,
    notes text
);


--
-- Name: deck_heroes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deck_heroes (
    preset_deck_id uuid NOT NULL,
    hero_number text NOT NULL,
    is_primary boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: decks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text DEFAULT 'Моя колода'::text NOT NULL,
    code text NOT NULL,
    cards jsonb DEFAULT '[]'::jsonb NOT NULL,
    lands jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: game_chat; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_chat (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    player_id text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: game_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_players (
    game_id uuid NOT NULL,
    player_id text NOT NULL,
    health integer DEFAULT 25,
    hand jsonb DEFAULT '[]'::jsonb,
    deck_remaining integer DEFAULT 35,
    "position" text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    nickname text,
    player_order smallint DEFAULT 1 NOT NULL,
    last_seen timestamp with time zone,
    deck_pile jsonb DEFAULT '[]'::jsonb,
    discard_pile jsonb DEFAULT '[]'::jsonb,
    land_setup_ready boolean DEFAULT false,
    actions_remaining integer DEFAULT 0,
    free_draw_used boolean DEFAULT false,
    paid_draw_used boolean DEFAULT false
);


--
-- Name: game_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    zone_position integer NOT NULL,
    player_id text NOT NULL,
    cards jsonb DEFAULT '[]'::jsonb,
    land_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lobby_id uuid,
    status text DEFAULT 'setup'::text,
    current_turn integer DEFAULT 0,
    current_player_id text,
    game_state jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    winner_id text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    turn_started_at timestamp with time zone
);


--
-- Name: lands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    land_type text NOT NULL,
    description text,
    image_url text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: lobbies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lobbies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    host_id text NOT NULL,
    status text DEFAULT 'waiting'::text,
    deck_host jsonb,
    deck_guest jsonb,
    created_at timestamp with time zone DEFAULT now(),
    mode text DEFAULT 'standard'::text,
    turn_time_seconds integer DEFAULT 30,
    min_level integer DEFAULT 1,
    max_level integer DEFAULT 1,
    password text,
    current_players integer DEFAULT 0,
    is_ranked boolean DEFAULT false,
    landscape text,
    name text,
    game_id uuid
);


--
-- Name: lobby_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lobby_players (
    lobby_id uuid NOT NULL,
    player_id text NOT NULL,
    deck jsonb,
    ready boolean DEFAULT false,
    joined_at timestamp with time zone DEFAULT now(),
    nickname text
);


--
-- Name: preset_deck_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preset_deck_cards (
    preset_deck_id uuid NOT NULL,
    card_id uuid NOT NULL,
    slot integer NOT NULL,
    is_landscape boolean DEFAULT false
);


--
-- Name: preset_decks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preset_decks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    hero_slug text NOT NULL,
    mode text DEFAULT 'standard'::text NOT NULL,
    landscapes jsonb DEFAULT '[]'::jsonb NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    winrate numeric(5,2) DEFAULT 52.00
);


--
-- Data for Name: Heroes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Heroes" (hero_number, name, description, card_type, cost, attack, health, has_flip, flip_description, mechanics, script, image_url, rarity, hero_slug, land_type, is_rainbow, created_at, updated_at, id) FROM stdin;
3001	БиМО	Сбрось карту с руки. Нанеси 1 урон выбранному существу.	creature	1	\N	\N	f	\N	[{"type": "ability", "effect": "discard_hand_then_deal_damage", "params": {"cost": "discard", "damage": 1, "target": "any_creature"}, "trigger": "manual"}]	\N	\N	hero	bimo	blue	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3001
3002	Билли	Если колода противника закончилась, мы победили.	creature	2	\N	\N	f	\N	[{"type": "win_condition", "effect": "win_if_opponent_deck_empty", "trigger": "passive"}]	\N	\N	hero	billy	any	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3002
3003	Абракадабра	Посмотри верхнюю карту своей колоды. Если это Радужная карта, сыграй её.	creature	1	\N	\N	f	\N	[{"type": "ability", "effect": "peek_top_play_if_rainbow", "trigger": "manual"}]	\N	\N	hero	abracadabra	good	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3003
3004	Монка	Раз за свой ход можешь повернуть применённое существо.	creature	1	\N	\N	f	\N	[{"type": "ability", "effect": "untap_one_friendly_creature", "trigger": "once_per_turn"}]	\N	\N	hero	monka	good	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3004
3005	Марселин	У твоих существ с ироном 5 и более +1 АТК.	creature	2	\N	\N	f	\N	[{"type": "buff", "effect": "+1_atk_to_friendly_with_cost_5_plus", "trigger": "passive"}]	\N	\N	hero	marceline	swamp	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3005
3006	Лимонхват	В начале своей фазы Сражений, если у тебя 1 или более пустых земель, получи 1 НР. (Не превышай 25.)	creature	2	\N	\N	f	\N	[{"type": "heal", "effect": "+1_hp_if_empty_land", "params": {"cap": 25}, "trigger": "battle_phase_start"}]	\N	\N	hero	lemongrab	sand	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3006
3007	Джейк 2x	Раз за свой ход, когда существо под твоим контролем ранит противника, нанеси ему ещё 1 урон существу на своих линиях.	creature	2	\N	\N	f	\N	[{"type": "ability", "effect": "on_damage_deal_extra_damage_to_enemy_creature", "trigger": "once_per_turn"}]	\N	\N	hero	jake_2x	any	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3007
3008	Ледяной Король	Во время каждого твоего хода, когда существо под твоим контролем в первый раз атакует или получает +1 АТК, наноси ему +1 АТК.	creature	4	\N	\N	f	\N	[{"type": "buff", "effect": "+1_atk", "trigger": "first_attack_or_atk_buff"}]	\N	\N	hero	ice_king	ice	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3008
3009	Гантер	Существо под твоим контролем на землях с Ледяными фишками получает +1 АТК.	creature	1	\N	\N	f	\N	[{"type": "buff", "effect": "+1_atk_on_ice_lands", "trigger": "passive"}]	\N	\N	hero	gunter	ice	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3009
3010	Грэй Принс	В свой ход, когда существо меняет свой6 в первый раз, ты можешь сбросить её.	creature	3	\N	\N	f	\N	[{"type": "ability", "effect": "discard_when_first_card_changes_state", "trigger": "once_per_turn"}]	\N	\N	hero	gray_princess	swamp	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3010
3011	Фионна	Когда под твоим контролем только один или милый земли, у твоих существ +1 АТК.	creature	1	\N	\N	f	\N	[{"type": "buff", "effect": "+1_atk_when_only_one_or_empty_land", "trigger": "passive"}]	\N	\N	hero	fionia	good	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3011
3012	Деревяшка	В каждый свой ход можешь сбросить карту со словом «Пирог» в названии и получить 1 действие.	creature	1	\N	\N	f	\N	[{"type": "ability", "effect": "discard_pie_card_gain_action", "trigger": "once_per_turn"}]	\N	\N	hero	tree_trunks	good	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3012
3013	Сильная Сьюзан	Потрать 1 действие и уникальный контроль. Нанесённый урон противника по разным существам увеличивается.	creature	2	\N	\N	f	\N	[{"type": "ability", "effect": "spend_action_unique_control_split_damage", "trigger": "manual"}]	\N	\N	hero	sus_strong	corn	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3013
3014	Рикардио	В каждый свой ход, если сделал1 НР, это попадание верхней карты своей колоды. Можешь сбросить её.	creature	1	\N	\N	f	\N	[{"type": "ability", "effect": "on_heal_peek_and_may_discard_top", "trigger": "once_per_turn"}]	\N	\N	hero	ricardio	swamp	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3014
3015	Призмо	Если у тебя нет одинаковых земель, у твоих существ +1 DEF.	creature	1	\N	\N	f	\N	[{"type": "buff", "effect": "+1_def_if_no_duplicate_lands", "trigger": "passive"}]	\N	\N	hero	prismo	corn	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3015
3016	Джейк	Существо под твоим контролем, лежащее на повернутых землях, получают +2 АТК.	creature	2	\N	\N	f	\N	[{"type": "buff", "effect": "+2_atk_on_tapped_lands", "trigger": "passive"}]	\N	\N	hero	jake	good	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3016
3017	Колдунья-охотница	В начале цары. Выбери карту из3х и более бомбы. Когда она выбрана по своему слою, выбранному противнику противника.	creature	2	\N	\N	f	\N	[{"type": "ability", "effect": "choose_3_plus_bomb_card", "trigger": "war_phase_start"}]	\N	\N	hero	huntsman	corn	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3017
3018	Финн	Существо под твоим контролем, не получайте урон выбранному существу.	creature	2	\N	\N	f	\N	[{"type": "protect", "effect": "prevent_damage_to_friendly_creature", "trigger": "passive"}]	\N	\N	hero	finn	good	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3018
3019	Космическая собака	Потрать 1 действие: «Посмотри 4 верхние карты своей колоды». Можешь добавить одну из них в руку.	creature	2	\N	\N	f	\N	[{"type": "ability", "effect": "spend_action_peek_4_add_one", "trigger": "manual"}]	\N	\N	hero	space_dog	corn	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3019
3020	Принцесса Жвачка	Один раз за ход можешь нанести 1 урон существу. Это существо получает +1 АТК.	creature	2	\N	\N	f	\N	[{"type": "ability", "effect": "deal_1_damage_target_gains_+1_atk", "trigger": "once_per_turn"}]	\N	\N	hero	princess_bubblegum	good	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3020
3021	Волшебный чел	Когда играешь карту, нанеси 2 урона контролем противника.	creature	2	\N	\N	f	\N	[{"type": "ability", "effect": "deal_2_damage_to_enemy_creature", "trigger": "on_play"}]	\N	\N	hero	magic_man	any	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3021
3022	Принцесса Пупырка	В свой ход, когда существо меняет свой 6 в первый раз, ты можешь сбросить её.	creature	1	\N	\N	f	\N	[{"type": "ability", "effect": "discard_when_first_card_changes_state", "trigger": "once_per_turn"}]	\N	\N	hero	princess_lumpy	blue	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3022
3023	Леди Либредос	Если во время твоего хода мы или существо из2 или более HP бросает, мы восстанавливаем 2 HP.	creature	2	\N	\N	f	\N	[{"type": "heal", "effect": "heal_2", "trigger": "any_creature_dies_with_2_plus_hp"}]	\N	\N	hero	lady_rainicorn	corn	f	2026-08-23 16:25:11.301622+00	2026-08-23 16:25:11.301622+00	3023
\.


--
-- Data for Name: card_art; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.card_art (id, card_id, source_url, source_kind, is_primary, variant, width, height, created_at) FROM stdin;
0099eddb-f746-4308-9055-a075cde42894	55bfe759-5ab3-4df2-ab4f-d7b4791b03a0	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
01cb3f04-c49b-4b95-9967-ec5cd59f5161	28eda665-0626-4aaf-8073-e05d22aed99f	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
01f214a7-e403-4240-8114-65584c4e3218	85ffaf46-d495-04bd-3b9b-fa41a911e462	Card Wars Fiona vs Cake/кейк/cuts/cake_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
01f4e376-640f-4c42-a946-8d578dbfd594	4bb0c695-58d5-4369-9f45-714e86e96d53	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
0201ec83-d5ff-44ea-b924-acc5fa4ddb4b	2b2f3937-b9da-406a-be35-ec001e1c607e	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
021fd156-3dab-4ce1-9730-d2797104e551	86a9ebb9-4d7d-491d-85a9-ad19f102a951	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
025dca12-3e51-40d3-86e7-d4f50d3c9a2b	0d85f09f-1e0d-c402-08cf-63e7a3aa73f3	Card Wars Finn vs Jake/Финн/cuts/finn_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
03a940f9-ae07-4046-9c9d-98f6a458413d	6962e552-e9ef-1030-7569-8d389fa5da7f	Card Wars Finn vs Jake/Джейк/cuts/jake_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
03a9819b-696e-45b8-a72d-db4c3bed971d	8d77f0a7-515d-4d69-9870-e1ae3c17337d	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
04343a5b-a1cf-4ef9-b8d9-13c6dfbac8eb	55221c16-bdb8-4fc8-9f70-6e40a5e9c362	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
046c3fec-4755-4079-862e-7aa2f583dee7	5c546e85-3670-f1e9-6297-16cf232524b6	Card Wars Finn vs Jake/Джейк/cuts/jake_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
04cc30db-9b1f-4318-985f-679087aa4a8c	c4d524b3-b951-4a09-b4f6-baf6f7e8572a	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
04d0b1ec-c438-4319-a0f7-0765e2d33e07	ecf991aa-bd56-4c6e-84ea-7cb8e5763bd8	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
04f62dcb-7bd9-49e1-8747-6963c8a283a1	96d8f3cb-4bb4-4226-a30a-a81198d38d4b	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
055a6714-1deb-4443-ba31-1e3a264bd8a6	5f24662c-4f35-43e4-893b-b0e107c459dc	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
056a7308-64df-4670-b85a-845e7d1ce670	8488324a-06b3-ab47-5c48-bba808d20427	Card Wars Finn vs Jake/Джейк/cuts/jake_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
05728299-f0b8-44ea-a477-84d938ca598a	e5e29ff7-28e6-49b4-a37a-b09c39d9295f	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
05fa5b55-3069-438d-a7a6-0bc1cb04e11c	f290116f-2e09-47e2-b42d-03db7874af7e	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
063a4412-3ccf-4d05-98ca-527f96794c19	be125807-81fe-4c79-9be9-7eee011e2047	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
068d9c88-4b44-40b8-8b03-f28528e45cb9	0e6a2530-245b-423f-a62b-54b63e17fbe3	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
06918ee5-6959-4de8-aba6-472f6b15c4ac	ef93e0c1-7333-47fc-a77a-d5d28972054c	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
06a639c5-54e4-45ab-b99c-5e181a384a25	f325dcba-3df3-45d4-b4ab-0034e3a496af	Card Wars Finn vs Jake/Финн/cuts/finn_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
06b95f9b-f108-4c21-b23e-7669127486d6	7ff90b5a-58b4-4983-8e65-dbf8f95d99b3	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
07ff90d1-f812-4e07-8c33-638d52d03ad0	ac40138d-3827-4e24-b84d-2fbcb1412c08	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
0811b2a0-7a31-4d29-adcd-dee53fdddc2b	c670ebda-5c1c-4897-8137-62289b57a723	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
09209fa4-a84c-478a-8788-65f53253bb6f	4471cb7c-e4e7-4e02-814e-ccd2b10bffd9	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
09d1736e-047b-4180-9a65-33206b9364ed	69fd5f11-7ca5-17b4-4938-cab72a2288fa	Card Wars Finn vs Jake/Джейк/cuts/jake_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
09e3fc8b-5eb7-427e-b083-9a825bf167c2	a8ddbfe3-a721-42c1-b26e-b762c76d9978	Card Wars Finn vs Jake/Джейк/cuts/jake_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
0a3a06a3-6eca-4fc0-8a58-cab76c94cb69	944ff964-c242-46a1-bea1-e4c212326619	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
0ac1e025-cb9f-4580-8ece-9b07d31936e3	00286762-cca6-42a1-a904-ff9e2fc20b3a	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
0ad48285-3df1-48cb-9b40-e124ddb631b7	d99ad950-5296-4285-a38c-8dfed74df0bd	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
0bbc6d55-01e2-4a21-9829-5937f90c15f4	71ebca0e-8f0f-c296-da3c-5cd23b006b24	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
0c1df22e-683a-4080-bf3c-1d888d0dfd56	3ecd0a25-be8f-4987-a356-2e2812a1e0ed	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
0c55953d-fb79-4684-9ec2-a766da4c13d9	dc5369c6-cce8-39a9-2435-5e8026df6745	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
0c6461f7-83a8-4dc5-b71f-b22a842b53f9	bdaf3344-d51c-4c0d-85c5-3255191f020f	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
0c7059b9-9239-495f-88fd-3c1fc6718666	091f42b0-e27e-43f8-9efa-a4f98c64567c	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
0d077146-47c5-42e0-8b7a-39de69d42956	01d41265-814d-4b9d-8856-6b9ef0f09739	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
0d289bed-c289-45f9-9852-7986b09646f1	2fe32de8-ac6d-4e9c-b959-47fc8089301b	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
0d399446-a770-482d-b87c-97e2bc8a81f4	ac940e2b-1aec-40c6-9e52-a4f968e7b465	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
0d76637f-03bb-4047-a714-c2646f12f401	b735bc4c-4be4-4fc0-8119-d775a8c1de31	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
0dc6939a-3013-4422-b094-d5002bd43b13	b75a4a4a-eb49-a0ab-fa24-5a0abab25719	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
0dc6f660-f556-45e6-8421-b6211e38d774	30fd927e-b6f7-40e8-9cd0-794a9c0777c9	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
0eb2fb0c-e448-4292-b027-ceaac6d8211a	d049c17e-0097-4bb7-980f-286de5e8d100	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
0efde255-dbdf-4fc0-b16a-a8f115ffc068	5c546e85-3670-f1e9-6297-16cf232524b6	Card Wars Finn vs Jake/Джейк/cuts/jake_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
0f066100-a41e-4330-833c-24905de4c1ad	7228ef3b-1118-4eca-9ed7-3c6c7f526fb1	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
0f363d6c-e4c5-47c0-ac3a-27bae79549ca	edb2995b-d2aa-4ae1-93f3-842eeee455ac	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
10d7f912-8788-458c-aa78-351e4024f691	948b8fd3-e7e3-4d4c-9096-70991675642f	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
110773f6-2282-4605-9393-b17d2d6b668e	2bb706a3-9791-45f8-a367-6225705d8085	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
114cfa72-6e51-43b6-9d16-b2f2987fd6f3	5645073d-ce0d-40ce-91bc-5ed051a48f4f	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
11b81eb3-e6d1-41ed-a044-2568968c6970	24cfe0c8-eab4-8e69-cc95-621af614e353	Card Wars Finn vs Jake/Финн/cuts/finn_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
2123e37e-033d-479e-89ae-e0ba4e5486c7	f07beaf0-bfca-5d8e-16d0-06d87d163a22	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
11dccdd9-50ab-4e56-8b4f-9b640df0b538	9acf6ca7-1b42-492d-811e-e0e090a9156b	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
127a87d4-49c9-4630-9d5b-9b0b6abf878e	ee3a33d6-cfbd-4922-a94f-5bbe6721ddf2	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
12e7adbe-c565-4b2c-8e29-7804a8aa375b	0a623ca1-1d49-42b3-a18d-26feafd59da1	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
1301f4e2-0ff5-480c-9786-5416b10e895e	c83a9cb6-430c-c5d9-3b80-1bb3b26d5d04	Card Wars Finn vs Jake/Джейк/cuts/jake_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
1368b472-8273-4185-8e0f-f6eb3ede46e9	19c2c236-8e9a-4ec9-b7e2-83cf395af342	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
136edeb0-6ce2-4320-b706-238fb231786d	da711ace-1ce4-49e6-9bab-29ba32152bca	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
14bb9f48-868d-407c-9176-fc67a84acdac	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
156c7cce-27d8-4c96-8d42-d2d0be253b20	5f24662c-4f35-43e4-893b-b0e107c459dc	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
159d65c9-1c87-4d8b-992c-223f384a4f63	8c1be572-1fee-4bf1-8a3d-205a8c5b05a6	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
15cd5a70-d7a6-4274-adac-06462b25cbac	cf269ef4-cfa1-4ad9-a423-540ed2698fd9	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
163812d4-56f6-499e-b162-8f3ac74bbb19	56947d0e-aed8-7957-bc8a-35cd89777ada	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
16eba814-e920-46ec-82f5-37e641060691	611bfcbc-eb9a-4d8c-9c22-788ccdb918c9	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
172474cf-1557-4773-8ee5-4f6dc0e283a8	da711ace-1ce4-49e6-9bab-29ba32152bca	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
1739ab3b-306b-446e-a2c2-54227391b9a8	eaa11cff-4d19-46f6-8742-a9cda948832c	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
175b2be2-06e8-40f9-89e9-4200c86d3e1e	54adf4a3-f1c0-4d03-9d11-cdbecc1e971b	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
17b0995f-0a0b-4019-bb8d-fb057afd5ff1	00cab774-035f-42d6-938f-966edd90c390	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
17cfbdac-c710-4597-a497-ac2486d0bc93	18f43003-491f-378c-1dc2-6daed587d8dd	Card Wars Fiona vs Cake/кейк/cuts/cake_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
182d6d86-3811-4f78-8d2c-5073ebf42b20	7e469d11-e743-4f4d-a468-82c8268766db	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
18578f50-0fd4-4ad1-9102-79120d13da43	6b358d08-ac3a-4675-ae72-d60d6238f457	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
18f43cf8-46e7-4bfc-bb29-1e34471becd4	b23481c4-04b9-4dbf-a8cb-428a7c296663	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
18f975b7-96b7-4e26-b7c3-596a8ac1fafd	bbd0a576-665a-4500-98a6-1305cffe837c	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
19097b75-56a2-45e7-9ca9-ee496f4f3fea	c066bcfd-cb90-488d-ab94-d54e6d3e7271	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
19610f08-5ca0-4741-b7c7-ea519be0bb9e	2fa57040-8e36-4191-96ef-1f38674f62ee	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
19c27c7e-ceae-4938-bda7-8fcb1eebde65	155186bc-e508-4562-a18f-216be9796752	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
19c5739d-1787-4009-a932-5d7900fb9471	843a00d1-1e31-4c0b-9839-00b283fd2216	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
19dc879b-d572-4b17-970d-0c0b3f675ea8	74618acc-175b-4caf-95b7-b36689ea76f3	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
1acb0e2c-00ef-43b9-a0ea-8db242b6ff2b	97a13c55-f654-49df-a7a9-0ad57fc4be50	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
1b31b81d-474a-4e49-b6a8-810a3758f74a	2ffb81ee-0b37-40ca-a114-99ce544d6a8f	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
1b6cba41-2fd6-4ad0-b70e-bdf4affc77a2	fb1b8c0b-fa19-a6aa-4a79-d3119961d94b	Card Wars Finn vs Jake/Финн/cuts/finn_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
1b6e910d-ff04-4aa6-833d-e1467c19c67b	21df0e5f-d10a-4bee-9292-c895ff975d93	Card Wars Finn vs Jake/Финн/cuts/finn_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
1c21f186-2462-42eb-a5f0-3b5b0d33a7b0	5f55ea55-153a-4c7e-ad93-d5c00132fe34	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
1c61c741-4515-4e9e-adb0-aaa5eb35453e	d43571d6-808b-4bd2-84f9-f77666c43bde	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
1d57edba-1ffc-4613-a421-70f3eaafe333	2c5bd0ce-b966-4e47-88a9-5745f38f7053	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
1dbc1faa-7a57-4970-8a7f-5cefc1a90ae9	75daba8e-8e91-48e6-8f29-1efb6623d34d	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
1ddc3cb8-08b7-4373-b4b7-22992f7e6e92	790e8a03-c9e1-7c54-1205-8c55f248db59	Card Wars Fiona vs Cake/кейк/cuts/cake_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
1dffe7dd-8f8c-42ef-a937-1a7e901b09af	e89958b1-fee0-dadc-9ae6-85a381ad0f29	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
1e487d35-9fa2-42cb-87d4-f46116a51813	57a5b82e-8ece-4d63-8771-96ddd6f002ad	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
1efe2ef9-c446-43f6-aece-c35cb2e40f71	f04044ed-e05c-470c-8186-08167d3ab96a	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
1f0e7586-5a4c-4b76-a8d9-8f8fd94ebe62	ac40138d-3827-4e24-b84d-2fbcb1412c08	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
1f3b3e13-443d-4e3c-99df-c14aa2384ef3	dbf7b725-76bc-45ee-9dfc-24c4f33eddcf	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
1fb8df09-919c-4560-ac0b-a6b6ac251872	8a8ce05e-f7e9-f046-32aa-db4fddc587db	Card Wars Finn vs Jake/Финн/cuts/finn_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
1fd396e9-4d13-4ef8-944f-f7eb3b08c838	1716abfd-b0b1-414f-84f1-82ee005928f6	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
201f8563-b8ca-4379-83c6-58c6d551631d	8d093f6d-0ae9-43a5-83c7-8977abb052c5	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
202a9370-f08e-4cc4-8521-6798d692b1cf	4aba6ef2-c748-451c-a240-1a054578802b	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
202bd6c5-8d13-4659-8c17-be14c3e1dde1	8a8ce05e-f7e9-f046-32aa-db4fddc587db	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
2049c851-2da9-4b46-aa98-2b209c6c186f	fbe45134-a0a0-43f8-92df-1b4fc2a23dab	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
204e3a0f-a092-4e5c-a46d-1e7b4d68ad40	bddef5c5-1e0a-4884-af24-e27e272b2b4f	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
2056359d-e19e-4206-9d4b-7b7befe68d20	a1728344-ed7b-4575-bc31-9ddf4bee7778	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
20a0e962-eadf-4349-8875-059bb1becf69	29ac0a01-d149-0707-d649-9bc690d1df9d	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
20ad175b-db95-4fad-a78d-837e3cd30faa	a0287a96-2d70-4208-bde7-d168c527ee0e	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
213a430e-aee1-4c0b-a63b-fd7c291dbac3	89c28960-52c7-9002-5ca5-5ea59c6c3cdf	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
21692b88-18ef-4751-ab13-d3634584c3c6	9f32a7db-1fd9-4773-beae-c7b8c133bacc	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
21a5a9ac-0605-4354-b94d-527a9d3ffdce	5ee124ac-e24b-43e1-8127-aad55140cefe	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
21fa121f-5e70-4ba8-8d79-62e5f023b1e3	9380efb6-542a-4399-bc5e-2b5a8e8826f7	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
225c1290-dde9-42e4-ad07-3835d6f6302f	c16c7d6b-f57c-4700-9c3c-53d69f9ff9c1	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
22afd1f9-2732-4f7a-a1f2-cc251577229a	a2eac635-5748-3650-f2e3-bc108c8198f3	Card Wars Finn vs Jake/Финн/cuts/finn_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
23343885-7bfa-4622-9933-ea55aee94297	d7a51d26-a7d0-402f-a5a3-4df6a83dd96a	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
2359216f-20e8-423b-83a6-579b031ba00b	1716abfd-b0b1-414f-84f1-82ee005928f6	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
23c05812-f165-4893-841b-a5ca92f05757	5fa3df14-d0c8-8ec1-976b-b827b260de4a	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
23fe4ef1-52e6-4425-a0a8-df98241ef292	184a0b61-8f24-4ac1-8986-b727929130a7	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
243dcec5-8af5-4946-b22a-b0665cc5ee4c	c7ab0f6e-9fdb-4643-8043-dba35acf255e	Card Wars Fiona vs Cake/кейк/cuts/cake_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
2527d048-e2aa-449b-b5fb-45cd26771940	89c28960-52c7-9002-5ca5-5ea59c6c3cdf	Card Wars Finn vs Jake/Джейк/cuts/jake_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
2578b60e-c287-492a-9d92-da0c23561730	42e3f80a-fc68-45b4-b707-fd40fcf511b0	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
25a62335-64d1-4b01-a740-b23d12a7382b	cbd1c873-3718-4ebf-aeba-be7c7fb09a35	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
25d3558f-a5b9-44f6-b965-bb1f3be18751	97d36a75-45b5-d49c-539e-dceac93872ae	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
25d739be-538b-46ac-b4f3-23992c411d8d	6beb29f5-48cb-4a9d-93a6-314154d23e52	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
2633e2be-bf36-475f-adf2-33e6b6a22018	c41d1804-b5fb-4ac1-af0b-31ad034f1ecc	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
2669b159-3226-4b6b-9eae-d8c0c91e5bde	ad944788-4a61-13f4-42ad-5c7da6951d35	Card Wars Fiona vs Cake/кейк/cuts/cake_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
26847e92-1dad-40a6-97be-e0c93006bf45	0d558d38-931d-49e4-a745-a5421139d762	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
2735bb45-7daf-4c19-94c4-47f6c9b62ad0	b23481c4-04b9-4dbf-a8cb-428a7c296663	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
27b78786-5e20-4a01-8fa8-b916e2630953	d467b1d2-2d3e-9c1d-4e64-5a20a178a93f	Card Wars Finn vs Jake/Финн/cuts/finn_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
28412016-cc0f-4251-b16c-bc395201e753	0d85f09f-1e0d-c402-08cf-63e7a3aa73f3	Card Wars Finn vs Jake/Финн/cuts/finn_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
2879769a-1052-427b-afcb-2a0e859f7055	c838729a-e9e2-4f16-bc4f-aa0d01f06cda	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
2879c957-6917-4200-8e10-7f9196e341f7	86be6c15-52ed-4867-92bc-0abc6219ec87	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
28c719bc-d8ff-47b7-8cf2-60b86f00d202	55126f85-0d07-4b88-9e34-fab9877e512c	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
28e22e02-1144-499b-82f2-087c83e31167	eabf35b6-89d0-462c-a213-b17c04ad03ab	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
29b45f7b-b346-4e86-aa0c-b49199f70dcf	315984b2-6321-4c3e-b46a-7e6510a2001b	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
29d3559b-e855-4721-8e46-b02a7af0b6a9	8058eb47-e5b6-4c8a-bb62-bc5b3ca5e027	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
2a054dda-cfa6-469f-afcd-5c902583cfa0	0764e611-45e9-4691-b478-1ca39de3534a	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
2ababfd7-9394-419a-89c4-878cd08bcd55	3b528d96-b951-fde0-7c6b-d50d7c7095e6	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
2ad67321-ed59-4620-b2bb-6b86d7dc398b	e73ba017-aa33-414b-a64b-e8feac40ba1f	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
2bc6ee7f-a812-425e-ad0e-b0a6715d01a8	4d93bb51-fc90-5aaf-7620-0f72f96da306	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
2c4365f3-9c9b-4929-be70-a74f0e3d63a7	3986cfe7-f862-4e18-a762-af7e6b6f999e	Card Wars Finn vs Jake/Джейк/cuts/jake_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
2c4ae8c3-34e9-495a-9d25-7c27316bde65	03765705-5e6c-4fb8-bfd0-9f022aaad97b	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
2c615791-8fe5-4b27-b173-a2a71630d95b	15d3a16b-40e0-4fdb-8782-1a633f9f6411	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
2c888ed1-dbad-444c-b26a-c67ceb395cd5	0612c379-8d7c-4ec0-ac73-0e3fca13cf85	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
2c92eb56-cfb6-4a86-9798-411365f87f4a	e89958b1-fee0-dadc-9ae6-85a381ad0f29	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
2cb7872e-bca0-4ad1-ac3a-7d1412808aad	3ea5e72a-5a0e-429e-ab82-51bdfbe72ef0	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
2cf08084-d0ee-4b27-9476-ef5f955abc92	ad944788-4a61-13f4-42ad-5c7da6951d35	Card Wars Fiona vs Cake/кейк/cuts/cake_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
2cf3e956-4f21-417e-a1d7-14ad49896f53	df57fbe5-71d3-472a-b2e9-81113fbc415e	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
2cfe63e9-2a09-463a-ab94-1f75d727eac6	3a377408-57fd-4a20-a8a7-da6f2b3fef03	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
2d741f1d-a754-49f8-ad51-15b85b463a53	660325d8-04dd-4291-8e71-326cb2e5ac09	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
2d77a95f-0ba1-4ea9-a5d9-653b292b066f	143a0f28-6ee1-4da0-ab19-fa3da7085fab	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
2df1e896-8e4b-4a56-9333-70b16d93a5c9	2ffb81ee-0b37-40ca-a114-99ce544d6a8f	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
2e196cf0-c096-4cd6-9ba7-b65c7a0b037a	4bfb81ec-b14b-400c-b1ab-c08794ef71d3	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
2e21d746-362a-4419-9ec6-72a1eabb6f9b	12a58dc9-dcc6-4b2e-85dc-e7231837019c	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
2e6379da-7d92-46f3-934e-5ce8203fd84d	ecc1b12f-ee41-4346-9ea0-4c9027bb380e	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
2f451296-2379-4aa5-ae89-0ba3cebbadb6	89c28960-52c7-9002-5ca5-5ea59c6c3cdf	Card Wars Finn vs Jake/Финн/cuts/finn_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
2f48a3d9-f5f8-440e-b0c2-e2fa57bb219a	1db4f266-5b6f-4e88-a9c1-122719af76fb	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
2fc1d017-c2d0-43a9-84a6-64920d5a5e91	6962e552-e9ef-1030-7569-8d389fa5da7f	Card Wars Finn vs Jake/Джейк/cuts/jake_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
2fc7302f-28b0-4632-b45c-26fde3822ec3	c7ab0f6e-9fdb-4643-8043-dba35acf255e	Card Wars Fiona vs Cake/кейк/cuts/cake_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
2fd1df16-3635-4ada-8272-4b470d11b134	728cc8a6-1a2f-4f90-9932-8aefbff75847	Card Wars Finn vs Jake/Финн/cuts/finn_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
30bea56f-1a21-45ff-8361-7922f584d33e	c69d3460-b4bb-4165-a095-57ff211c4f6a	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
319472dc-7376-470d-8e9b-9bfd1b2c8765	611c77a9-de38-55dc-0da6-9639c0250dd3	Card Wars Finn vs Jake/Джейк/cuts/jake_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
320fbd33-0014-4014-8b38-c553a35915fa	f2cbe886-d826-48b0-9013-b0052f3abf63	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
33c1f8e7-cc7a-449b-9cd3-2774486f91e5	ae721416-6f82-434f-8d22-ab3e8dd6c87e	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
33e9abf2-fe9f-4dc6-abfe-9ff842b8712f	4edd78fc-8bb7-4767-894f-0c3d06a6ba67	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
3509f3ad-242a-4ded-bd32-819c480e05fa	196e641f-20be-4577-bf49-179abe0284aa	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
354d47f2-8321-426c-bb71-9b2efd30a444	03082b08-4731-612d-52c3-0837ac27fe52	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
355b1520-09de-4f6b-a096-ef046a75606a	6112ef7f-50a8-47a6-975f-63ed606e8473	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
35a72825-157a-4732-a80b-6439202b06ff	afd18c4d-f595-4e03-99ca-fbc782ce4e45	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
35c7cfde-8db1-4dce-a743-f3bf95b74e33	8d4b7911-4202-4c91-9f16-9d0e3c20536e	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
360cd339-bb9e-41e6-a59d-7e06f7e1963b	ad746d92-5c4f-77c1-1cd2-dcede2d880f4	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
36df14ee-e955-4c9a-9b93-9e7f4c51dd1a	8da809af-54dd-4191-ac24-3ffc4d3cbc14	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
37194df1-2d89-40f6-86e2-7eafaef1bc60	de3028bd-0067-636a-c2c9-af5095da96c9	Card Wars Fiona vs Cake/кейк/cuts/cake_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
3751dd35-c23b-444a-b6ee-806eb96b0432	8c1be572-1fee-4bf1-8a3d-205a8c5b05a6	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
38c90598-cca8-47bb-b598-ac07a8da0fe5	a195e43f-cf00-46cc-b1a9-387940a82ae5	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
39af9157-d1b9-4699-a690-335132de8d2e	6a6a67e7-0e41-4501-bb80-ecf887c8ca9e	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
3ab75a21-8949-4a3a-b7bb-1c6fa12e6c7f	2949a9cf-7560-422e-beb3-e27e0e83a920	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
3ad9bd14-ad29-4996-ba8a-5f736bfb5634	8a2ee4cd-8437-37bc-9f20-ccf9388b6fbc	Card Wars Finn vs Jake/Джейк/cuts/jake_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
3b24c270-c71c-4bdf-9e2f-79b62dbd8596	24cfe0c8-eab4-8e69-cc95-621af614e353	Card Wars Finn vs Jake/Финн/cuts/finn_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
3bc8ce5b-1435-4e18-891f-c68b763e2d0a	4bfb81ec-b14b-400c-b1ab-c08794ef71d3	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
3c090fde-8267-43b2-a385-9a6597439295	611c77a9-de38-55dc-0da6-9639c0250dd3	Card Wars Finn vs Jake/Джейк/cuts/jake_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
3cc5eddf-0e55-4f57-904c-bcf4884827f2	8ad2f612-8b70-15c9-2b56-f4484fd0a1b1	Card Wars Fiona vs Cake/кейк/cuts/cake_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
3d684bb2-3c31-4b5d-9c27-fc428f19eefc	1b7ae872-9779-4c5b-9521-a148f378f0e3	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
3d7ed38a-d3c3-4b6e-b944-a36ddc5604d4	87d393d3-3269-4b47-ab9c-b3a0df46bba2	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
3da78f1a-af2d-40ba-ace3-c8a2d06c02c2	89b8def4-506f-4aab-b045-4ac70dfa6138	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
3dd09421-cf02-4bdf-b3b6-3cbaa1530ab1	d3453e07-908b-43c1-a169-65a04f4ba779	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
3eb997b4-cfdb-4ffb-a586-2419cb6a7f24	7e52d9a4-1c3b-3f1b-5dc8-7169fb82b7ab	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
3f07bed2-4291-46a2-8e2b-62ac4362048f	c51317ee-c6ac-4b42-a3d9-44588592e315	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
40222fb3-69ab-46c7-a0b7-0e5761c075b2	cd8b183d-9c9d-4d2e-b093-ec866b7e7a44	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
408b252a-ff66-4cac-9ebe-2e885b5a6f40	2bb706a3-9791-45f8-a367-6225705d8085	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
4109eee2-c71c-4379-aa6b-b1121d2b9d15	8211dffc-b9d3-430e-8d99-eb6816401511	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
41e1b467-f2d9-4ef3-8cf4-58da45244a10	3c9e5a67-f07f-4509-b49e-1e585c66f603	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
423be5f6-0ab3-4e43-98ce-5f3b452cccda	10093d14-96b1-4e1e-a559-899f018080a0	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
42d75137-de2b-4a21-b2bf-88bed9c129ef	c46d6947-0e5c-4813-86b4-9cfd94726cba	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
42fad890-065b-4bac-aa03-0516b1af8663	80a3b161-1d64-4b2e-be87-ae6656013d51	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
43409ff5-07e7-436e-bdf4-65d3594dd3e0	f1860cc1-713f-4f89-b480-e4473beaf327	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
434adf50-ae57-465e-962f-a4b69236e58d	155186bc-e508-4562-a18f-216be9796752	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
43fbb6f7-cb51-4b7c-ae16-8846d8300b0a	5f55ea55-153a-4c7e-ad93-d5c00132fe34	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
45039542-31ba-408f-a7f7-56fe1ce9c333	3c9e5a67-f07f-4509-b49e-1e585c66f603	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
456fba62-cabb-43e8-b6e9-7235f4c32687	c662fa55-8df0-4f95-ac29-80d560ba7b29	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
45cd0456-b963-4095-bdcb-07e9c82c8177	1b8a452b-2a5f-48dd-ab15-8bfa0559a8df	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
45e31bb2-733d-4a82-b7e6-b0502527d699	46fd4dc7-669f-49aa-b746-5568cb927919	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
46d9f467-88bf-486c-85b8-86dfebf013d1	8d77f0a7-515d-4d69-9870-e1ae3c17337d	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
4708d2cf-d7bb-4fda-9790-2bddb9fb5e2c	24cfe0c8-eab4-8e69-cc95-621af614e353	Card Wars Finn vs Jake/Джейк/cuts/jake_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
4728a46f-a657-42d9-ac26-9977866f5fe7	74c1ce31-9fda-4df9-8706-c4ca7a13742c	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
478a4757-68de-43a4-a4c8-c5fe7bdc8fa6	186834c2-3c54-4557-a005-046228fb9094	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
47a2c9ca-f22b-4464-9a18-dfd84835e22c	1b8510d7-a8af-4570-b22c-4b6f40bd577f	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
47b39be6-ebde-451f-892c-d8160a38ea37	b465c176-75a7-4aca-8369-f6b2712ba706	Card Wars Fiona vs Cake/кейк/cuts/cake_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
47e2747d-e656-4ec8-b120-927176840f12	b892b2b6-c971-4042-a758-92ed9296f38a	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
47f10ccc-79dd-4454-8544-b446fd4d0081	091f42b0-e27e-43f8-9efa-a4f98c64567c	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
480529f4-be40-452c-8e2d-1a77946b0745	a93c7b37-9296-8538-2f2a-8da870125d12	Card Wars Fiona vs Cake/кейк/cuts/cake_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
483b9e45-3bed-4440-be8d-c61722548433	7a3849ec-3514-411c-b3ea-8290b6297880	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
4897dbde-7fab-4c4e-a260-b4525a4ea7f7	2949a9cf-7560-422e-beb3-e27e0e83a920	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
4926ee6e-b7a3-4bf9-9f83-7a6e978b45bd	9107def3-4ea9-4e74-bf64-27d5fc72c2cf	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
4987fe60-68a8-460b-bba1-4c2beef98d63	5811ce91-38c7-4567-a434-8514bacfa601	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
4993e803-aabe-4b95-aca4-ae261eab400b	8cfd0bbc-fa3c-72eb-837c-f08faf21faae	Card Wars Fiona vs Cake/кейк/cuts/cake_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
49cb2cf1-655c-4439-8a43-07494bee8188	afd4e817-701c-41ae-86cb-c2216f044d9e	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
4a2ece7d-07da-42d9-9c62-63ff8fb44fe0	f5e3be67-ae25-4556-be2a-898001e1a1fb	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
4a3b39e0-8e6c-4cef-8c8c-8b772d877ede	45886a9b-ab18-4739-90a0-55780dc7e3b2	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
4aeaf4b6-4dd1-47f0-96af-8b643ab47098	1ec9e57b-2a39-fe2e-813e-562f7ac501f0	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
4b242afa-17e5-4407-b9bd-92ca95f746b1	e82b5601-8cef-41ca-ae3b-cc3fc07745e5	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
4b26fc6d-7131-4ee3-a2de-8b3c0ca71711	766142e4-df6c-490d-9720-388aec49be9c	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
4b831964-2219-44ae-b52c-7a444428338b	3b528d96-b951-fde0-7c6b-d50d7c7095e6	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
4d2b31bb-7b35-4c41-b703-345ef2883355	7601edb2-69d1-df7f-6467-2654ac3ba0a8	Card Wars Fiona vs Cake/кейк/cuts/cake_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
4d30b604-7223-4df9-91f1-3662593f7896	2b2f3937-b9da-406a-be35-ec001e1c607e	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
4d851880-fbdb-4bbe-ac65-29e0b4c927a6	86eb2dd2-b3d9-472b-a4b6-9a52a2807468	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
4e37d121-472e-4378-9c66-8a64b0950eb5	0bfde5fe-962c-4cac-8786-41306887d08b	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
4e952a65-5ef0-4d65-b28c-2c8a0ae7d7f4	d8d3e7b6-1d4b-4c86-8e5d-bc0ffb5f4c5d	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
4ec4cdfb-9245-489e-a61f-81a71752e399	18536825-81ef-1a3f-a7b2-c66c10a52523	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
4f6366a2-c904-4445-8ae0-a76b2cc11fed	73b39f6f-1a38-4649-b1df-b15c6f12594f	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
4fbbb54c-e74a-46c0-b43d-4036c4e30cf4	790e8a03-c9e1-7c54-1205-8c55f248db59	Card Wars Fiona vs Cake/кейк/cuts/cake_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
502e8752-d658-49bd-b829-ab4c874e017e	c261ef94-6821-ddef-0f8f-d46fbbe43ac3	Card Wars Finn vs Jake/Финн/cuts/finn_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
519bba7f-1543-41ba-b7f8-f8f1bb60ee9e	0a0967c7-9e13-48dc-b54a-bb5476c024a1	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
5299413b-f1a5-4ac7-9d26-d34c4fcc4acf	0bfde5fe-962c-4cac-8786-41306887d08b	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
52c64b9d-2140-4da7-903d-81f5ce05df81	e9d7a323-2500-4c01-881f-ceff63f34da7	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
5312e273-add6-4960-8c66-ff3064ce5577	ee509393-99c3-4a16-a611-ef14eba5bdc9	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
53dc5353-e9cb-4f8e-a503-923d446f9397	4d441fb7-162c-40fb-b1f8-418d758274d9	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
549b90f3-ec75-414f-a0f5-f0968772d81b	eaa11cff-4d19-46f6-8742-a9cda948832c	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
54e84c20-a07d-4a9f-926e-61cffb1de103	d8408690-b25b-4ae0-9097-fe2840e778f2	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
54eb2480-8198-4bc1-abc9-3289fb27b43d	d3995422-83f3-4abc-b023-9cd11e903faa	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
554405a1-25fb-49a4-9314-8b99d646b354	3ac700eb-8c26-42b3-84bd-4ef56d2bd323	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
55622700-9d69-4d72-99a7-0bacca5c2c97	de3007dc-75a1-48a8-b958-645fbb6f1672	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
556d1245-fef6-4c4e-9541-de1d1f93474e	c8c6eccd-a594-0e99-33c9-6d482e7eed8d	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
5577de7c-fa1d-4f07-989d-46e36d7d9c5d	1663ae32-8957-4c03-b9b7-df5a5d443500	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
55d4485e-9015-4486-8383-d5d334d925a2	6ea959ef-c4cb-4b3d-91d0-aac96ed8b5fc	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
5655ff59-57dc-4cf9-9c4c-a6f40d05682e	9c07e203-5132-490d-9a28-99715f146c8b	Card Wars Finn vs Jake/Джейк/cuts/jake_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
57405cc4-0e90-4d2a-a903-7e091e7bd92a	2949a9cf-7560-422e-beb3-e27e0e83a920	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
57c40202-9340-445a-8224-e112eb07dcc3	0612c379-8d7c-4ec0-ac73-0e3fca13cf85	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
58272626-f55e-473f-b746-f4f30d6a5779	436d901e-4646-ad9d-de1c-345bef37cbb5	Card Wars Finn vs Jake/Финн/cuts/finn_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
583c0e1e-dbf1-4f43-8355-f375140814b3	02ebf806-906c-49a6-8fef-7881087ce1c3	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
58e1e1f9-a9f8-43a5-b064-5921763d5607	2d073746-6718-4c18-aa7f-e666a4d92a1c	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
58e28c03-0bcf-47cf-af9e-ec273d2ab353	ae205022-f051-8b23-a553-fd6c3a0f7067	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
5926932e-1020-4a53-84bf-3c48745939d7	d2fd6ffa-ab9e-4506-bf09-80eb38e42106	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
5a114246-5d88-46ad-aecf-f3f1a307ac35	dbf7b725-76bc-45ee-9dfc-24c4f33eddcf	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
5a1ba6c0-85f5-4112-82e9-27f31a75b02b	d2730724-3fa7-4341-82fb-a8b4efc16614	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
5a6d5e24-3b03-4fbd-818d-f9f5c63768e8	7e52d9a4-1c3b-3f1b-5dc8-7169fb82b7ab	Card Wars Finn vs Jake/Финн/cuts/finn_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
5c380b1b-ebb8-46e7-a6d4-d6510eee2a7f	4d93bb51-fc90-5aaf-7620-0f72f96da306	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
5c80cb1c-8a23-4212-aa66-3766ebbe8adb	6b02e3b0-9160-4fca-8eb9-8e763a370d80	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
5cbc137c-19e8-4147-8e73-796c55b05ed0	8a8ce05e-f7e9-f046-32aa-db4fddc587db	Card Wars Finn vs Jake/Финн/cuts/finn_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
5da96fb5-03dd-479e-97aa-bbf4c98bf23f	74c1ce31-9fda-4df9-8706-c4ca7a13742c	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
5ed360c6-3855-4fc8-adbe-fac5e3832e7b	4cec5560-04d0-45ea-93df-f70aa172c5f1	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
5ede5ac6-a1ec-4eb2-8bfc-b75942668a50	7636519c-863c-43e5-8a30-e46cb0a4201c	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
6029ba1c-9544-4183-8b36-c132aae2193c	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
6277a4c4-f80e-41a5-af33-c46733a8d602	cefeb98c-f664-4e47-89bb-8f2adf9a7f70	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
6278f677-3e6b-43b8-bbb7-81f29f82f7a1	e73ba017-aa33-414b-a64b-e8feac40ba1f	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
62d34d2a-5553-48af-8898-48e12232eee6	0d22812a-1ff3-4fbd-8364-76ab7c5049f3	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
63afcd3a-b5ef-4f4b-89b5-f08494e6b1bb	4f50de13-3714-43be-8bf4-65cffa582670	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
641a4e91-9288-4274-bd8e-bea70b75d0d6	dfa50411-7342-4e4e-ba02-f01fcd07597f	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
649b9dde-388c-47dc-b587-e1010b23e3d4	611bfcbc-eb9a-4d8c-9c22-788ccdb918c9	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
64ae2c51-c953-4f76-a782-2d232622e7b3	a5d7756c-ef3c-8237-dbf6-b96d7aaf6ebf	Card Wars Finn vs Jake/Финн/cuts/finn_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
654b4a36-0bf6-47e1-b655-6be240fb50e9	bdd42340-8682-1677-b01d-f519cf250ee3	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
654c0544-85bb-4468-91c9-66b91560da8a	51c54ef4-99d9-4b84-a1f9-c5a35665a750	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
65680d1b-7f80-4927-bb46-6089f898af5a	62a799f9-2f09-c225-c938-53ce2dc7cfc5	Card Wars Finn vs Jake/Джейк/cuts/jake_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
6584b1f7-2785-4739-b3f8-d10ea2a64e24	65307864-1cdf-4559-b8a2-b40bc44d1b58	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
65b5703e-c3c1-40a4-a814-8c8c4999edfc	50018881-73b5-72ce-92c0-9455cf4b873b	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
6641801d-218d-431c-941d-d996660ce292	4cf69a10-c61c-49c2-ac09-885cb8dab41c	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
6689c181-8660-44f6-bd0d-f63eaca53f01	b196dd4c-b1ef-4686-b86c-875bdb561c14	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
66d9f2bc-5d01-447b-8eba-56763ab4a8ab	ac0b95eb-04f0-4d48-b2a8-48ab18e9c90f	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
66dee716-78f9-431e-bfba-8ac8c8a44362	d3a97f75-1a6b-d532-1682-202fc3f63274	Card Wars Finn vs Jake/Джейк/cuts/jake_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
671fac2e-22f7-43a3-adc1-f23dac262747	91a6434b-c439-4d59-b384-7691aa5b2136	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
672e097e-8e16-4493-a4dc-841f0dddd0c1	626c5745-d091-45cd-a8ed-b68c0cab5ce7	Card Wars Finn vs Jake/Финн/cuts/finn_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
6823ae4d-7104-4c4f-ad10-ad94d128e84d	a688bda0-a3af-46d0-82c4-89b02b3ccf42	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
6864e302-3418-4a56-b775-a980bff08c3c	683d5639-5fb2-4262-a433-2d690921ec5b	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
68a5bd1b-b7f6-471f-a125-f1627bc0dea3	b813f8a1-8306-4ffe-b410-b629bc167da9	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
68e4cbe8-aabe-4ee0-ad0c-545781f1aba1	3ac0ad44-4705-4258-9d12-6701ed7b75ed	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
691e1074-c11a-4570-a5c6-e7d2f7965b27	5118435f-a645-480b-b8e5-b081fb37120e	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
69da7add-bad3-4484-b3e2-3eb4f310404f	01d41265-814d-4b9d-8856-6b9ef0f09739	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
6a1c0e7f-05ab-490a-9717-c5a0973cb3ca	4e4ec732-7060-4c54-1111-8d9de93a6ebc	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
6aeee2de-3432-4895-ac89-26557be72d6b	96d8f3cb-4bb4-4226-a30a-a81198d38d4b	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
6ba8f82d-885e-4949-8538-6beb56d24d63	8d5dd2e5-2a74-4794-b63b-9bcc4a59b940	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
6bdfe96e-79dc-41f7-b941-835ce14d25ff	626a4f12-9991-4da8-8a5d-fa76d44cc502	Card Wars Fiona vs Cake/кейк/cuts/cake_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
6c94f904-78c8-47bf-8dca-7872bc218e72	8211dffc-b9d3-430e-8d99-eb6816401511	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
6cf51981-48d6-46da-a737-1a6598d0b350	7bd1dbe1-1036-4e6d-ba52-56e6f1f65842	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
6cff091f-b7dd-45e3-90ff-80d298c04a27	4cec5560-04d0-45ea-93df-f70aa172c5f1	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
6dc4452e-030f-445a-85ce-791eb0f4d4c8	c6e0153f-6ce7-494e-a1e6-48f1daf5b927	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
6dcea596-4095-4b45-b040-ab6cf5d66625	c066bcfd-cb90-488d-ab94-d54e6d3e7271	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
6e9d7578-dd0f-4658-91b2-39b546c95b39	98052819-04fa-1fee-1828-ad08588718ea	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
6eafe0d8-8adf-4d70-8217-1e0b6ee5c6bd	d819b7d7-8f6e-42de-8d58-dfb6ce9dbcd4	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
6eee5023-8b6a-48db-9780-234a1fb58995	cefeb98c-f664-4e47-89bb-8f2adf9a7f70	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
6f1c626b-03d9-4704-b455-9f4d1abdff4a	99e8e9c0-6ef9-4434-f28b-7dcab8802518	Card Wars Fiona vs Cake/кейк/cuts/cake_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
6f944863-a0fe-4101-8170-6859a5386490	737bb0ac-ebac-49d1-aa56-cec823f30425	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
6fb7341a-cda6-4369-b21c-900eca6aca2f	5ee124ac-e24b-43e1-8127-aad55140cefe	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
6fd03664-6989-431d-9bba-96036eee6773	fbe45134-a0a0-43f8-92df-1b4fc2a23dab	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
6ff9f2de-2fe5-4e1a-9bed-0e5596b260d8	9dd03067-9d4a-427c-b815-9c115a8ea029	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
6fffc74c-5363-4cd2-a5e8-999f83f65aeb	9b8650f5-05d2-4055-acd7-253591d25cb2	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
704f44f0-4437-4484-8589-8b924d20ef97	5645073d-ce0d-40ce-91bc-5ed051a48f4f	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
70832664-67e5-4fe3-adce-bc39ead6db05	89b8def4-506f-4aab-b045-4ac70dfa6138	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
71cb6ca6-d127-4b56-a658-4b31574b4a01	f1860cc1-713f-4f89-b480-e4473beaf327	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
71e94666-ccf7-4b2f-89ab-f2b3825dc8f7	140365b7-588f-4fe2-8431-f9ee4f9eb1e5	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
7241cfa7-f0a8-4d2b-8d33-25b9102161b5	45886a9b-ab18-4739-90a0-55780dc7e3b2	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
72b7026b-809c-48dd-a390-92dc68d852fa	d8408690-b25b-4ae0-9097-fe2840e778f2	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
72e41f88-f955-467d-be81-0fe5db433dca	8a8ce05e-f7e9-f046-32aa-db4fddc587db	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
74080106-176e-4ecf-b21e-388beb08af75	7698b207-bc0a-428a-97d8-25324581e209	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
75fae0bf-88e8-4f1c-8d27-c63ab7c45c0a	5f65e291-035d-485d-9415-dde0c9fefdc4	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
760d30a9-e2cf-4679-9ef3-0e1d11cdc5de	6962e552-e9ef-1030-7569-8d389fa5da7f	Card Wars Finn vs Jake/Джейк/cuts/jake_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
76866318-5290-4fd6-8ebc-438c73ba5369	19bb7834-b488-4cde-a33e-fec3684c4466	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
77b594a8-b360-4e9d-90fa-af83ed47c9b6	03082b08-4731-612d-52c3-0837ac27fe52	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
77dcd187-53cf-4bb6-8103-955e27160559	7e469d11-e743-4f4d-a468-82c8268766db	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
793a8b73-9660-4260-93d4-e54a2a859d15	d39eda70-52df-4612-bd5f-a79e86b78eb2	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
79a1e431-8ae8-4d06-8f37-63d96b401c40	7dc19f6b-a2a0-d69a-5411-f1fd2768d953	Card Wars Fiona vs Cake/кейк/cuts/cake_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
7a16fff3-e46f-4f7d-b924-90bcf7f87ba8	a0f27839-45f4-4ad5-946a-e945eb2ed5ec	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
7a2db97d-4f38-4e53-9a36-9bf073366236	89c28960-52c7-9002-5ca5-5ea59c6c3cdf	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
7a6068cc-bd20-4eb7-9f06-dbc492618b8e	dac829dc-c627-42eb-b3c8-fc576f34f5e2	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
7ae96ca8-6b4e-43ef-b54a-9e12e48a11f0	71ebca0e-8f0f-c296-da3c-5cd23b006b24	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
7ba669b6-8e42-437d-b5de-f2a4838b14e5	746e3527-35db-4ea6-8c26-7358fb8b9ecb	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
7ba66c8e-57c0-42d1-b9ee-11054abce7f7	0764e611-45e9-4691-b478-1ca39de3534a	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
7bb93d24-fb0b-41a0-95ef-2725dca44197	24cfe0c8-eab4-8e69-cc95-621af614e353	Card Wars Finn vs Jake/Джейк/cuts/jake_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
7c5ab873-92a1-4a5b-8967-a6545005b0a9	3af26101-f649-49b7-9aa6-7be25e0d0ac2	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
7c9656a0-cf7d-41ad-9bdd-09e804fb0a77	8cfd0bbc-fa3c-72eb-837c-f08faf21faae	Card Wars Fiona vs Cake/кейк/cuts/cake_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
7d36dbd9-9af0-4133-b2f2-a05d1c79f2f6	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	Card Wars Finn vs Jake/Финн/cuts/finn_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
7d40c1bb-2463-4012-b5b3-29e3c6a3ce01	53cb2d21-cbce-4e09-83da-14ff862891dd	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
7d635a13-bdc4-4d30-8bf9-59ded6bcd859	b813f8a1-8306-4ffe-b410-b629bc167da9	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
7dbe87c4-e637-43fa-93bb-0f8bbcc9319e	b0c57480-a382-43fa-aa27-6b81a3620bd0	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
7dddb132-1f33-452c-ad7d-6c99a055edb4	c01a55b6-f4a3-4dfd-a8ed-297ea1ed14c3	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
7e62f442-2604-4ab3-862d-27038786b238	3ecd0a25-be8f-4987-a356-2e2812a1e0ed	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
7e7ab494-7f81-484a-91a2-280eedc69472	d4b5e1b4-d4ad-465a-ac1c-3196c36a5f49	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
7ec6b4b6-a955-48f7-ac5f-c3e72d3aac8f	c198d6a0-9c43-49c1-83ab-430ecac4a939	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
7f04abe9-267a-4e90-b83c-445e19e436ea	e9d7a323-2500-4c01-881f-ceff63f34da7	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
7f07dc2e-d303-4d6f-9d2a-6a62e25d7e17	03082b08-4731-612d-52c3-0837ac27fe52	Card Wars Finn vs Jake/Джейк/cuts/jake_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
7f3e61a2-3cac-487f-9470-0a6adfa05b28	31dee8e7-d0ae-4f8a-897c-85ea95dcf56b	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
7f8510c9-f59a-4561-a697-bab1d2a9aca6	1b7ae872-9779-4c5b-9521-a148f378f0e3	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
7fcb3537-d054-4fe7-9eab-33dbbeb424a0	c62705c8-53d3-42e0-8f51-421ec70f06f5	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
7fe210b2-d957-4e7b-8327-20981377472b	60f6209b-6dcd-df3a-e2dc-8a6a32364c3d	Card Wars Finn vs Jake/Джейк/cuts/jake_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
804116ad-62ac-48d3-9936-ee9598a86bdf	bd8d8986-054d-41e6-9b27-b0449e92f84e	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
80651abf-4d75-42bb-8b7f-cf686624fc47	f42845d5-1793-4aa7-a5e4-91d1b3ce7072	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
8065a7d4-d0e7-40d8-b5b7-3bf177cf6da0	47d56d6b-e909-4d3b-a83f-0d36f3a68165	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
80971c64-0773-4eb1-9fb4-bb078a0d2512	a072bf5d-dc70-32bf-f7e0-479c1bfe329c	Card Wars Fiona vs Cake/кейк/cuts/cake_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
80b366a3-05d5-4bee-8200-59b7d53f0941	8488324a-06b3-ab47-5c48-bba808d20427	Card Wars Finn vs Jake/Джейк/cuts/jake_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
80cbba50-cb9f-4a51-a94d-8103576348a5	1b8a452b-2a5f-48dd-ab15-8bfa0559a8df	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
80f349f9-e99a-41bb-9655-85ac533b0058	737bb0ac-ebac-49d1-aa56-cec823f30425	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
8101acbf-eabb-490b-a2b2-dd9de4036bc3	14808116-18a1-4c69-8fa6-cc4c913bea1e	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
8192c804-5d7e-42e5-9400-a1b5de97a477	b1e4abf6-db47-4604-b470-aae9a235aaf2	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
819a8853-6c29-4abb-b658-faf497dd73aa	4ac368b2-ec89-455f-8a54-a4e86bf4f4f0	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
81c46107-eb3c-4673-8edb-6e693834ba40	916c9cc8-7311-4dfc-9f7e-c0c76ce9f477	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
81cb5238-ce9b-42c6-8819-14b0494fad57	4f50de13-3714-43be-8bf4-65cffa582670	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
81d0e560-5e89-4cac-b6cd-772fc58b278f	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
82bc0f8f-ef86-4f35-841c-d9be9e4f7d0a	35178668-42aa-42d0-8092-d81804201449	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
8397e78a-433f-4e3f-96a2-b3c67d345505	8a2cc3af-1080-415b-8115-4d6abbe5a4aa	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
840d0bd1-e976-4dce-ae38-83c8f03b00e7	ca467fb5-afe2-4a9a-8736-af21c72c7620	Card Wars Fiona vs Cake/кейк/cuts/cake_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
85b100f2-e6d5-4daf-a733-b51545561893	ee992d35-e6c6-4b5f-8b03-3813caf62ef8	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
85ce5903-04e8-4143-baaf-908f279b944c	d467b1d2-2d3e-9c1d-4e64-5a20a178a93f	Card Wars Finn vs Jake/Финн/cuts/finn_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
860e5bf2-35f6-4c77-8ffd-33aea953abfd	c838729a-e9e2-4f16-bc4f-aa0d01f06cda	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
864cbf31-6711-4013-8ab8-fbd306d5bff8	1bf7dd87-3e2e-4901-a991-69e353d62d70	Card Wars Finn vs Jake/Финн/cuts/finn_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
86798474-bd4d-4430-9296-398eb027fd1d	315984b2-6321-4c3e-b46a-7e6510a2001b	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
870f0202-3ec1-4d03-80de-cff36f13902d	8cf94545-56da-4e84-aa87-8f212dab95b0	Card Wars Fiona vs Cake/кейк/cuts/cake_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
8739bb28-f50f-4a6d-98e0-c576f507a025	a072bf5d-dc70-32bf-f7e0-479c1bfe329c	Card Wars Fiona vs Cake/кейк/cuts/cake_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
87b47f5c-c745-41bd-aa55-967a5b3d9770	8da809af-54dd-4191-ac24-3ffc4d3cbc14	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
8856931e-2a93-4528-a8bc-e4e704d7eb58	8f2b5cf5-b2f8-40e4-a6bb-0ea839ee07c9	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
8880e731-3770-4759-8d6b-102184601d8d	99e8e9c0-6ef9-4434-f28b-7dcab8802518	Card Wars Fiona vs Cake/кейк/cuts/cake_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
891dde96-90f6-47fb-b6e4-79d91780e2ca	8ea494a7-0bdf-4686-8464-948f263eaab5	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
894a9312-629f-4b36-baac-b5f40912014b	1f767596-ec9e-43a2-bfca-75dffdc63355	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
89fe5aff-1833-4595-ac85-a44512da9f16	62a799f9-2f09-c225-c938-53ce2dc7cfc5	Card Wars Finn vs Jake/Джейк/cuts/jake_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
8a64e11a-755b-4ff6-b1d1-07f2505c95b9	be125807-81fe-4c79-9be9-7eee011e2047	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
8b3fc6b6-4888-4657-8d8c-4764a4ce6188	18926068-66e9-4c54-b195-2a6fc8b55446	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
8b438d91-1267-4a14-b2c8-0bfb73840213	03082b08-4731-612d-52c3-0837ac27fe52	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
8b57c71b-cc20-4981-885a-6d2b7e14d911	fe01b3be-7b88-4caf-80ce-3e4f111cee6b	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
8bfffa38-f6c1-4691-ae91-cefbf71f7c89	744cc7ff-d56b-1239-f238-6a3efdff08d1	Card Wars Finn vs Jake/Джейк/cuts/jake_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
8cb3242b-0ac4-45d0-9e9a-de37226a73ea	8058eb47-e5b6-4c8a-bb62-bc5b3ca5e027	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
8cbd5b79-2c73-4a80-bbf9-6b97020768d7	3ac0ad44-4705-4258-9d12-6701ed7b75ed	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
8d73047c-c1b5-4ee9-b733-626f1236571e	46fd4dc7-669f-49aa-b746-5568cb927919	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
8e482c03-e9ab-4ddc-8ed2-7daed8a42dc5	98052819-04fa-1fee-1828-ad08588718ea	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
8f2d4cc7-c153-4700-95b5-e9fd71fd80e1	6c4de6a4-0e0d-4a58-96ef-d9ae0ae0ff2f	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
8f3f4240-3826-472b-aa00-a6b6b27b34ee	3d48417c-a22b-4c3c-98ea-79d77f977eb1	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
8fdfbda9-86e2-4001-96a0-c7bbebf83828	6b74f280-3bdb-4ca2-8747-f67be5e9e605	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
905c930d-81ad-4e2c-9dbe-bc1e4ce9b03e	d049c17e-0097-4bb7-980f-286de5e8d100	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
90ccd870-724f-42d8-b9ad-1381b269dff9	29ac0a01-d149-0707-d649-9bc690d1df9d	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
90e85d58-4a3d-44c8-b00c-dd5aaa7df771	b196dd4c-b1ef-4686-b86c-875bdb561c14	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
91a94356-b9cb-42c7-a61b-4ab5f18878ec	9dd03067-9d4a-427c-b815-9c115a8ea029	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
91d6525c-8145-438e-8d54-7286375dec3b	60f6209b-6dcd-df3a-e2dc-8a6a32364c3d	Card Wars Finn vs Jake/Джейк/cuts/jake_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
92165660-65c6-4057-9854-0790236fc71e	33c624b0-7bc3-43df-8838-e11eca58a33f	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
92b9abc1-421d-40dc-827b-358b8eb1de4a	20c9d426-ad07-4207-a37b-c5a26a0d672d	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
92c93c48-f39c-4b74-b7ff-31e5e1a19263	3ea5e72a-5a0e-429e-ab82-51bdfbe72ef0	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
934867d7-7272-4b65-94e4-9c098123c9e0	03765705-5e6c-4fb8-bfd0-9f022aaad97b	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
93ccffef-2723-452e-b6d3-44b6b76372f1	b735bc4c-4be4-4fc0-8119-d775a8c1de31	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
93ceb69e-340c-4d56-b783-b4db01fb0ff6	d89a2091-bee7-4618-be33-d3818c81327f	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
93cf8bd0-8524-40d9-bebe-2ed6837f30f5	2fe32de8-ac6d-4e9c-b959-47fc8089301b	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
94b00f74-4c7a-40cb-a8ce-f97371602514	f290116f-2e09-47e2-b42d-03db7874af7e	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
950e07fb-9b94-4f0b-972d-2879be881bc8	4ad8fa44-8f54-42bf-892c-bc1e3a4104b4	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
959f5966-acf9-4687-829b-8913ebde55f2	f2cbe886-d826-48b0-9013-b0052f3abf63	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
96b1d92e-a767-410f-b898-f4151570972a	9e51f995-219b-455a-97f2-2a3d11bf662a	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
96cff864-d0ee-4e53-a415-75d979671059	85ffaf46-d495-04bd-3b9b-fa41a911e462	Card Wars Fiona vs Cake/кейк/cuts/cake_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
9744655c-eb35-436c-9ef0-1236096ccfd4	2fa57040-8e36-4191-96ef-1f38674f62ee	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
98a04971-fee7-4c0e-916f-6f8d1496f078	496d54a6-3beb-442f-b2b5-f3cc32cc61ce	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
99610244-29b4-49f9-b61d-4ea3ad910424	68743bc3-b732-411f-bf31-1f4df08ab9d8	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
99d85a5c-0051-48f4-a707-286df3250377	a6bfcaeb-5178-d4a1-43c4-4db5d8165f1e	Card Wars Fiona vs Cake/кейк/cuts/cake_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
9a58cb5c-a5be-44a0-9597-c1509b75c111	86be6c15-52ed-4867-92bc-0abc6219ec87	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
9a6d4ff8-fa3b-4446-8441-38723a59ec67	ea4e7b5c-211c-437c-a8f1-236ec0858cc1	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
9a9162a4-13e9-4d14-8240-aaeb852c123f	ec0915e8-7307-b576-34fd-d6cac8a82117	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
9aa783d6-46ae-4890-9c96-192e102fcbc0	3b528d96-b951-fde0-7c6b-d50d7c7095e6	Card Wars Finn vs Jake/Финн/cuts/finn_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
9adb1e91-2c16-4c83-9260-71e3abea174b	c801c4d1-781f-3d10-bb17-f1aba459ce80	Card Wars Fiona vs Cake/кейк/cuts/cake_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
9af144ab-2a58-4bd6-a2ac-0e4b473749ff	f25dbeb8-e618-477d-94d5-40d9fee1bfad	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
9b54fa34-cc29-4c9c-a74c-4c385651a766	5b9db681-bf83-402b-84e3-8a162686fef3	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
9b72c1b8-020f-41dc-b210-ccb9dd824e0f	30fd927e-b6f7-40e8-9cd0-794a9c0777c9	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
9b831ee5-fdf7-47e6-997f-2c5ddeff66d0	42e3f80a-fc68-45b4-b707-fd40fcf511b0	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
9c1fd415-d1da-463c-aa90-020d489f8287	10093d14-96b1-4e1e-a559-899f018080a0	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
9c628412-4455-4114-a4d1-0304b6c3c76c	0a0967c7-9e13-48dc-b54a-bb5476c024a1	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
9d18b180-916f-47da-bebb-5fffd26f249d	6112ef7f-50a8-47a6-975f-63ed606e8473	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
9da2e035-efe4-4f52-a163-4eb4a5574e6e	744cc7ff-d56b-1239-f238-6a3efdff08d1	Card Wars Finn vs Jake/Джейк/cuts/jake_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
9dca726c-17a1-48cb-9356-52dffaa0e8bf	5153f4c9-6303-4572-bc08-d48a3cf52eae	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
9deccc6f-12e0-447a-ba22-3ff89405ee1c	1f2150d0-d86c-4a51-9b53-c32797a15e8d	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
9e000abc-efde-4518-9f19-be5fc514dab5	21df0e5f-d10a-4bee-9292-c895ff975d93	Card Wars Finn vs Jake/Финн/cuts/finn_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
9e88d81d-3178-4e78-bac2-5883c9746462	8722f9d6-8f1b-44ad-98a2-bf9638ed25c3	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
9ef5eeb6-93e1-4469-a15e-b57c7f7cf5da	6a6a67e7-0e41-4501-bb80-ecf887c8ca9e	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
9f2944fd-b26f-4f9d-891a-e5390b7a96b3	dfa50411-7342-4e4e-ba02-f01fcd07597f	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
9f31c1d6-b870-48d9-a390-09800bd50b65	02dd3f6e-956a-e2b8-a8d0-8520a39563a2	Card Wars Finn vs Jake/Джейк/cuts/jake_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
9f882546-c1b5-4a2b-a042-a8edee5ba4b1	e5e29ff7-28e6-49b4-a37a-b09c39d9295f	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
a017a74e-7b8c-425a-bf89-b5cb44e5289b	20cff4aa-ae37-4a35-be39-df7738bb2361	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
a0f13626-783e-4aa3-bfeb-bbc6d25c9250	192b3884-2643-4185-bea7-2b59ff423295	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
a150d8a2-e4ed-4b2c-b77c-e9b306c2ae7f	f07beaf0-bfca-5d8e-16d0-06d87d163a22	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
a1a5aa6c-681a-4a9c-9e9e-617d8a7314f5	bdd42340-8682-1677-b01d-f519cf250ee3	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
a1b92223-4a61-4348-b5cc-287dc4a1acfa	afd4e817-701c-41ae-86cb-c2216f044d9e	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
a1ed3678-2b7c-4a7c-afc9-876495df2229	0a623ca1-1d49-42b3-a18d-26feafd59da1	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
a1ede797-cf6e-4b44-8cb7-8a8698174817	0a623ca1-1d49-42b3-a18d-26feafd59da1	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
a2967e34-9c39-4fc5-8cd5-756a4d01df8d	496d54a6-3beb-442f-b2b5-f3cc32cc61ce	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
a3bdee0d-6583-41cc-9ed0-6e7ddeae6a61	815dbea2-cc55-4dd2-9848-eb09e2765934	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
a49a3439-cad1-4e02-bb47-3896497a52ed	1e3e2aac-f1eb-b0e9-cdcf-bd1b6948834b	Card Wars Finn vs Jake/Финн/cuts/finn_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
a4ff2ea4-1d77-4211-8839-7b71e87f5f69	70f86e19-e0e8-40b5-999e-c9a4ebee91ce	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
a520a34f-9b5c-418e-af2d-5af9470c8c29	a0287a96-2d70-4208-bde7-d168c527ee0e	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
a5481b35-4f88-4f4a-a85f-dcca08a0dfbe	556ae9ba-3cd6-423c-b62b-13bd82cb105b	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
a664d0a1-6b6d-490d-95ca-e6d02ab708ea	3b528d96-b951-fde0-7c6b-d50d7c7095e6	Card Wars Finn vs Jake/Финн/cuts/finn_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
a696face-9be1-4182-b3c6-9bff59cd1022	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
a6b40980-9062-499f-91ec-01f403a3af65	8ea494a7-0bdf-4686-8464-948f263eaab5	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
a6db2299-724a-478d-b914-29bbdb2c7199	8d4b7911-4202-4c91-9f16-9d0e3c20536e	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
a6eeb707-e927-4c65-98c0-14d0db754ad1	916c9cc8-7311-4dfc-9f7e-c0c76ce9f477	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
a7255ae3-e392-4190-a85f-0df4a50c8247	cc2f7221-7a5d-47e2-87ae-e4931ca9c31d	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
a7761004-a13c-46e0-9883-2a21d89ad3bc	87e67325-37c0-4a58-86bd-16d3a47847bd	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
a797156b-d9f4-4946-bd34-b99570659fdb	02ebf806-906c-49a6-8fef-7881087ce1c3	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
a86535fd-2cf7-45d0-9b58-ef266f589711	c801c4d1-781f-3d10-bb17-f1aba459ce80	Card Wars Fiona vs Cake/кейк/cuts/cake_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
a8ba9ab0-ee6a-4aa8-8e80-1430245e7d57	0dc32317-e17e-49c4-b903-5c8373c392c9	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
a8c1bb28-4363-436b-ba5f-fe7f19462aaf	617d9d34-1570-4ccc-e3dd-2f955b38b6fa	Card Wars Finn vs Jake/Джейк/cuts/jake_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
a8f7241a-987a-4753-906c-f11ffd2668a1	b377455b-733e-401d-9a97-60da5b6c9772	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
a948e7a4-fe76-4e6e-ad70-ec4ecaebaa1f	1609e63b-ea3e-ef12-95ee-c430fce78726	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
a9ae7bc0-33e8-435a-b33d-c9fc1d166183	7dc19f6b-a2a0-d69a-5411-f1fd2768d953	Card Wars Fiona vs Cake/кейк/cuts/cake_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
aa494e64-6e4f-46c5-acc3-556ec4e67b69	d1c588e5-ee46-42ed-86cf-558355c76ae0	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
aaa973ea-5c7c-414c-a2bf-0700343063d1	bc73916f-aefe-42e1-bfa5-23497f11fc07	Card Wars Finn vs Jake/Джейк/cuts/jake_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
ab0598a5-5125-4940-a622-e8fa91047038	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
ab284172-7c5d-463f-839f-d9c2cf9186c3	03082b08-4731-612d-52c3-0837ac27fe52	Card Wars Finn vs Jake/Финн/cuts/finn_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
ad27cf72-5ee1-4233-867a-0949b9829981	ac40138d-3827-4e24-b84d-2fbcb1412c08	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
ae2f3202-a28c-4d4c-ad91-7406ba835139	c6e0153f-6ce7-494e-a1e6-48f1daf5b927	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
ae372861-0073-4735-b817-c96d52cd1251	54adf4a3-f1c0-4d03-9d11-cdbecc1e971b	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
ae5aab79-316a-4859-b0b7-0244c88df5bd	962ef500-7ff4-4835-9bd3-260fb0fbd972	Card Wars Finn vs Jake/Финн/cuts/finn_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
ae77c5db-c82c-4680-9c6a-feea2544f71c	03082b08-4731-612d-52c3-0837ac27fe52	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
b15c3caa-56ce-4d22-8e58-360ef8ec0e07	4471cb7c-e4e7-4e02-814e-ccd2b10bffd9	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
b1700554-a268-4c65-b3c8-ad1315012c88	03082b08-4731-612d-52c3-0837ac27fe52	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
b19e06a9-9337-46f0-a91d-10d7219fb73b	694c2fd5-0cfa-4a0d-a4a0-73a213345a2b	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
b2a49fd5-3c30-43ff-ad52-6252710c610c	211eb1c6-bd7f-4514-8b40-85cf63408c0d	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
b2b77a14-82f4-4637-8ce4-928d7195e49e	93bbdffb-903a-47e6-8c13-a5f8473fb19b	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
b38fab1e-d16d-4e0b-af48-88c54c08fe8d	3a377408-57fd-4a20-a8a7-da6f2b3fef03	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
b3aac39b-3220-4f6b-a8cc-c700d1be55e3	944ff964-c242-46a1-bea1-e4c212326619	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
b3ef00e6-133b-422a-8c56-1204ef857857	8227c90f-5504-4f7b-a7ab-56397a0cf5e1	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
b4acac0c-85aa-46df-b957-357499039a18	f04044ed-e05c-470c-8186-08167d3ab96a	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
b4da3a39-3979-4517-88e1-ea11a860c6b1	be0c8d5d-4d0c-4eed-af30-8847d3cea766	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
b60260d6-07df-4b87-a3af-fe316da27664	2949a9cf-7560-422e-beb3-e27e0e83a920	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
b63683ec-7969-48d4-b5da-01b7fd7e8062	50018881-73b5-72ce-92c0-9455cf4b873b	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
b65eaab4-0ea9-469a-aa16-482c87bb608b	16b96fe2-455c-4c3f-a346-e4fdf3e43432	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
b6cac520-1bae-4216-8fbd-fdf252f31ad8	f1433fba-dec6-3e5b-4ac2-ac5b54a97cf8	Card Wars Finn vs Jake/Финн/cuts/finn_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
b733e73b-5d6b-413b-8830-18bdac07d8bb	9e685460-a6d3-49e3-9fe7-f7a0e4f39d5f	Card Wars Finn vs Jake/Финн/cuts/finn_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
b7b118ed-31a0-4f90-be51-4e8906dca2ae	bdaf3344-d51c-4c0d-85c5-3255191f020f	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
b7cc1988-a6df-451a-acc7-90a830f3a91b	da78a028-7c5f-4118-ae1c-0af388512d09	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
b815817e-f2de-4992-8149-29ed4163b3b7	20cff4aa-ae37-4a35-be39-df7738bb2361	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
b85b4b6e-6878-4520-b8bb-4a80e6e72fb9	136f3e07-e8ec-49dd-8759-b4c8eee8317a	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
b85eda61-e4f8-4a56-8145-a77474c61022	cc2f7221-7a5d-47e2-87ae-e4931ca9c31d	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
b91a2433-af48-4d1a-bc4f-016cc12f8448	9b558a9f-01ce-4e72-9bc6-b2c2d8e7c4d8	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
b99004e6-342c-4448-9c39-2cccb5ca75b4	0dc32317-e17e-49c4-b903-5c8373c392c9	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
ba2b1aa8-1724-4e0d-84dd-86ad38fa0be9	bddef5c5-1e0a-4884-af24-e27e272b2b4f	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
baec0c24-3420-4008-af31-cbf3fdb83660	64712999-d918-43bf-ac3a-edd7722e4341	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
bafb80cb-11ab-4e38-baa3-157767fd6dbe	e5971cbd-000e-41cf-90dc-c761f4c1ad20	Card Wars Finn vs Jake/Финн/cuts/finn_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
bc778c73-874a-4cf5-8d92-e946d9bf7b0f	d3995422-83f3-4abc-b023-9cd11e903faa	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
bca27716-f46e-498f-8ece-ad8598923765	8a2cc3af-1080-415b-8115-4d6abbe5a4aa	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
bd1a459e-36a3-4ffd-a550-d3baf2e2bdf9	7601edb2-69d1-df7f-6467-2654ac3ba0a8	Card Wars Fiona vs Cake/кейк/cuts/cake_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
be5fd4bc-df9e-45e8-bd2f-b0b16d5b12ad	b9de05b8-6f96-4c27-a9fe-a15ba6c6654c	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
bead60dd-ea7a-496a-a22f-6d6f0ef5f787	12cc7479-32f0-f341-2b04-13a94516466f	Card Wars Fiona vs Cake/кейк/cuts/cake_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
bed43a8f-853a-44c4-a664-8af42d1fcd2c	de3028bd-0067-636a-c2c9-af5095da96c9	Card Wars Fiona vs Cake/кейк/cuts/cake_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
bf3b33dc-aa75-4b86-8f88-459d0ed4f5a0	03082b08-4731-612d-52c3-0837ac27fe52	Card Wars Finn vs Jake/Финн/cuts/finn_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
bfa488a9-83a0-4247-8ee3-a9fc53dbf69c	6af6e04f-5a4f-486c-bc0f-35f4aec96a1a	Card Wars Fiona vs Cake/кейк/cuts/cake_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
bfffaaf5-517b-4e77-b227-821b38e30e74	1663ae32-8957-4c03-b9b7-df5a5d443500	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
c0a72750-d6aa-4651-b14c-0d39950e35a1	56b9734d-1fd9-479f-8083-29d75fa32055	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
c14eacd7-f2d5-4114-8eee-3ac31fad2515	3b528d96-b951-fde0-7c6b-d50d7c7095e6	Card Wars Finn vs Jake/Джейк/cuts/jake_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
c1a1f585-1701-40ee-965c-b30ed4535fdd	bc31030c-fb94-454b-a228-27e2da9384db	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
c1ecaeb7-d428-4c1e-9903-cf481bee6033	091f42b0-e27e-43f8-9efa-a4f98c64567c	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
c23138b3-263e-44fd-a7eb-8755186555a4	bcb7b27b-ddd8-4b76-aa46-5a061cd4892d	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
c324aca3-690c-4716-8022-5d6bdb42f4e1	90cbf716-9b68-444a-9b72-e698e80689da	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
c35a4173-a75e-4301-962b-eb4cd7c03130	0cd6e56f-4e7c-43bb-a73b-d2ff44b9b3c2	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
c4072a07-9a25-4da5-9c8a-dac9479d721d	7dbcb8ec-dbb0-498b-b6ea-16cfec3e8f61	Card Wars Finn vs Jake/Джейк/cuts/jake_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
c443325c-5f5f-4b58-a8f2-c02b8f027bcf	43aa094e-74d2-4ff4-9dca-4d20cede6a25	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
c47c78f3-19e2-4f73-8266-270cda13ebe0	d4b5e1b4-d4ad-465a-ac1c-3196c36a5f49	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
c4bfa9b9-4adf-4b02-b1c2-dcdb7ad80eb2	1399b830-2a53-4910-a328-97da938c229e	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
c4f26b4d-4da2-4631-814a-1d27343e0c2c	642df00f-ac17-4c04-9ab5-539895f0c053	Card Wars Fiona vs Cake/кейк/cuts/cake_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
c56008b4-8326-4f6e-88a2-520ec65ca9cb	9e51f995-219b-455a-97f2-2a3d11bf662a	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
c56a06be-eec3-47ec-8577-7c6e3eefccde	436d901e-4646-ad9d-de1c-345bef37cbb5	Card Wars Finn vs Jake/Финн/cuts/finn_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
c5a33a6c-1b5d-45c9-a3e1-266dd04b7442	3c802983-2343-4e25-bf30-e1041b9bbcba	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
c6136f09-3ae7-4da2-ba0d-7d6d5c38c5dd	a93c7b37-9296-8538-2f2a-8da870125d12	Card Wars Fiona vs Cake/кейк/cuts/cake_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
c623be57-e26b-4d12-854b-0d3d6677725b	8d093f6d-0ae9-43a5-83c7-8977abb052c5	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
c7163aff-7527-425d-9032-1c141ab67005	497f133a-cc05-4e3c-aede-e3eb9d43906c	Card Wars Finn vs Jake/Джейк/cuts/jake_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
c717e836-a739-4cc3-94c7-359345163f74	b75a4a4a-eb49-a0ab-fa24-5a0abab25719	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
c7962749-344e-4640-8a22-44e5ec4c5865	c62705c8-53d3-42e0-8f51-421ec70f06f5	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
c7ec611d-8f1c-498c-9017-cab88f9123de	c662fa55-8df0-4f95-ac29-80d560ba7b29	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
c7ef6a6f-4981-406f-b5a1-0259db36eafb	546d7f4c-8ab9-4113-9f2c-be73f81b1f99	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
c8e35cb8-b4ba-47b7-8241-1d4cdba65eff	ae205022-f051-8b23-a553-fd6c3a0f7067	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
c93cd27c-57e3-457a-ac33-2eab4e8d2c5d	9e15c468-b722-45e1-ab52-e857ff2a06b3	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
c946c4fd-5da5-4a0d-8dbd-cf83bfb92075	9e15c468-b722-45e1-ab52-e857ff2a06b3	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
c9514a7f-8f54-4f3b-8726-bebab9c5a8b7	69fd5f11-7ca5-17b4-4938-cab72a2288fa	Card Wars Finn vs Jake/Финн/cuts/finn_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
c9ec9940-82f9-4564-8c62-a0b1055ae738	15d3a16b-40e0-4fdb-8782-1a633f9f6411	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
ca566cd0-4565-418d-8765-b62660b61a94	4cf69a10-c61c-49c2-ac09-885cb8dab41c	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
ca9f610d-5426-4071-8205-7ac5b8e497c2	12a58dc9-dcc6-4b2e-85dc-e7231837019c	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
caa47e3c-eda7-47a0-ada9-27e67e9e0934	0d85f09f-1e0d-c402-08cf-63e7a3aa73f3	Card Wars Finn vs Jake/Финн/cuts/finn_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
cb1b6d4f-a005-4081-ada4-8d86ae64ad91	1cfc52a9-c7a7-4cd8-9847-3cfe8069a012	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
cb1ed49a-b9d4-4136-a5c5-2ddb8db2cc3a	251a7ad5-6f2f-42ca-a2ac-71f26e70a758	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
cb21c6b7-4f0b-4447-ae5f-bbf9b7bf83bb	973995ae-435c-beb5-f300-547e7abc6b86	Card Wars Finn vs Jake/Джейк/cuts/jake_card_12.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
cbfaa57d-0031-4a12-9bd1-994a597c7bd3	56947d0e-aed8-7957-bc8a-35cd89777ada	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
cc72c444-6233-4253-8383-2277e1a84eb3	b9de05b8-6f96-4c27-a9fe-a15ba6c6654c	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
cd29724d-007c-4e0a-a3e7-5558d1414ee9	5153f4c9-6303-4572-bc08-d48a3cf52eae	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
cd6de597-f1d0-4c13-a711-323f2d0a9dfe	973995ae-435c-beb5-f300-547e7abc6b86	Card Wars Finn vs Jake/Джейк/cuts/jake_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
ce7c04de-2fe1-4745-9032-0d95a87e77d5	782b1508-c30f-4b63-b4b5-aca878c94ec5	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
cf300315-194b-4cad-abbf-54eb25af01cf	89c28960-52c7-9002-5ca5-5ea59c6c3cdf	Card Wars Finn vs Jake/Финн/cuts/finn_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
cf8290b6-87fc-466b-851c-ec583c14b45d	3f060748-f1c0-4731-9c8f-9949546e7093	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
cf968f61-31ce-4b1f-bb89-c4e10037d7af	e157beec-e1ed-44d6-81bd-6c83962e4dc3	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
cff6eb60-2e68-4830-bd86-0afd52e477b3	211eb1c6-bd7f-4514-8b40-85cf63408c0d	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
d0079de0-1b42-470c-b438-9b9cc957416f	8211dffc-b9d3-430e-8d99-eb6816401511	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
d02f0d27-35df-48b0-bb1f-33ed7e10e061	18f43003-491f-378c-1dc2-6daed587d8dd	Card Wars Fiona vs Cake/кейк/cuts/cake_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
d1304d7c-7815-4585-9576-594a967ddf19	cd7120e4-9f69-48d1-9048-ed625e5e6a00	Card Wars Fiona vs Cake/кейк/cuts/cake_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
d150d131-7755-411b-bb43-3ef6ff86e83a	c16c7d6b-f57c-4700-9c3c-53d69f9ff9c1	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_22.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
d1a2bc2e-936b-4936-ad1e-835d2b62e16d	132e1c0f-0386-4e06-9a7c-0b1a7c061cbf	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
d1a7572b-f826-4f44-b853-5f22ecd2a983	8211dffc-b9d3-430e-8d99-eb6816401511	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
d1ccaf98-e53c-41a9-89b5-f95a5f02bb90	ddafd5c3-4e1b-45c5-b471-875cde169fc3	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
d26a821a-e6b3-4cf4-9a0e-4a9e29e7cae9	a6bfcaeb-5178-d4a1-43c4-4db5d8165f1e	Card Wars Fiona vs Cake/кейк/cuts/cake_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
d2748899-d7ec-48f8-bbba-5c8533e37104	4edd78fc-8bb7-4767-894f-0c3d06a6ba67	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
d30b437e-be94-4a0b-93a0-816815cb513b	16b96fe2-455c-4c3f-a346-e4fdf3e43432	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
d3204ca6-1358-4eac-8594-12adf99634a7	d49826b4-12f6-fc29-0258-961dda1f8963	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
d452100e-98fe-4b3f-93f0-6693ed210cbc	97a13c55-f654-49df-a7a9-0ad57fc4be50	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
d4f5ed6b-d2e4-44a6-9b43-ec1a353ead16	00286762-cca6-42a1-a904-ff9e2fc20b3a	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
d5d956db-ae9f-48c3-9ba9-c21ea62635b7	9380efb6-542a-4399-bc5e-2b5a8e8826f7	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
d68fc60d-4603-4868-a753-c28ec36373cf	192b3884-2643-4185-bea7-2b59ff423295	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
d6c758ca-1a91-45a8-ad8c-c8ea1878903e	1db4f266-5b6f-4e88-a9c1-122719af76fb	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_25.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
d6cb05c3-b580-464f-a3fa-a42093efef48	70f86e19-e0e8-40b5-999e-c9a4ebee91ce	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
d6e683f9-0bea-4c84-a2a8-c16f23b70a15	19c2c236-8e9a-4ec9-b7e2-83cf395af342	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
d6e820e5-b8b3-4f49-8511-6026576ae928	d89a2091-bee7-4618-be33-d3818c81327f	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_16.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
d7242b9f-1864-4833-9bd5-a902b2a9fa00	1f2150d0-d86c-4a51-9b53-c32797a15e8d	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
d755ebf4-978f-4c10-9f7d-f44311d69ffa	b6c06e74-a2e8-4e80-9128-1eeff3d7cc5e	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
d7876839-9455-4976-9f5a-47dc5d62699b	2d151e22-1051-4499-aed7-1ba60dd23876	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
d78890ba-9d7e-42bf-bf61-780eddb09379	524d05a1-6fb5-194d-ec31-9f041a4ce29d	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
d81ba1fc-7c9b-44b9-8444-e4d966dc7e28	3d48417c-a22b-4c3c-98ea-79d77f977eb1	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
d88aa44d-24c0-4bba-9ed7-be809ce3053e	e6aca443-b57d-4d50-a967-c13d25996add	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
d8b9ee26-ad34-497e-b9fd-06008fc54c5b	97d36a75-45b5-d49c-539e-dceac93872ae	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
d8bcaee2-6b68-44e1-b6bf-38b500605d61	643302f9-f208-4706-a466-dc441838013c	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
d91742e5-f1c7-4c04-8d2b-68676560255f	55221c16-bdb8-4fc8-9f70-6e40a5e9c362	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
d925fbe2-bf89-4642-9745-3de653283cab	2235fc0b-6c63-4d75-8aa0-d886f332f8d9	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
d9ae6aa8-ea4a-41d4-96e8-2445f9dc29d7	0c1e3fa7-8634-4a70-a97f-e2fc5c84bf8c	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
d9c5db7d-ce3a-4767-9529-b2c4fc4aa0b0	cbd1c873-3718-4ebf-aeba-be7c7fb09a35	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
d9cb3a59-9172-4655-824c-8c4bf82f0610	9c07e203-5132-490d-9a28-99715f146c8b	Card Wars Finn vs Jake/Джейк/cuts/jake_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
da2cb94d-1db9-4d03-8557-67c52fef4be6	e157beec-e1ed-44d6-81bd-6c83962e4dc3	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
da410929-86fb-43d7-a221-1fe754e515bd	3986cfe7-f862-4e18-a762-af7e6b6f999e	Card Wars Finn vs Jake/Джейк/cuts/jake_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
daa895fd-3de7-41f3-acdb-9d7ddce28fd8	86eb2dd2-b3d9-472b-a4b6-9a52a2807468	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
dab6318d-ef3f-4752-bd35-1b30c028e1c6	6b358d08-ac3a-4675-ae72-d60d6238f457	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
db2b2aad-17f8-4257-8561-f9551261581f	8ad2f612-8b70-15c9-2b56-f4484fd0a1b1	Card Wars Fiona vs Cake/кейк/cuts/cake_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
db760f3b-bf8a-42d8-a54d-19461256515a	2d151e22-1051-4499-aed7-1ba60dd23876	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
db932c3a-199e-453e-8e5b-1cf3ab42ebef	69fd5f11-7ca5-17b4-4938-cab72a2288fa	Card Wars Finn vs Jake/Джейк/cuts/jake_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
dc6bdd86-a614-4eef-902c-9e63dbb76f54	a2eac635-5748-3650-f2e3-bc108c8198f3	Card Wars Finn vs Jake/Финн/cuts/finn_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
ddd29e9f-8a8d-421d-918c-cb3cd4d9529e	64712999-d918-43bf-ac3a-edd7722e4341	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
dee7c9b0-24c8-427b-9533-92bfe69f78d7	916c9cc8-7311-4dfc-9f7e-c0c76ce9f477	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
df72d3e1-0196-435c-9894-ad0bbd891572	b1e4abf6-db47-4604-b470-aae9a235aaf2	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
dfec0f8a-cafb-45ad-b9d8-3af313b617f0	65d39ecd-061e-4d69-9f04-3e762b4f1931	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
dffc17ad-7ba8-426f-a05c-849f663d6cdf	782b1508-c30f-4b63-b4b5-aca878c94ec5	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_1.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
e02d8f79-9220-4287-bc37-b5b3aa1ae2aa	69fd5f11-7ca5-17b4-4938-cab72a2288fa	Card Wars Finn vs Jake/Финн/cuts/finn_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
e0e0a174-6e57-4cf4-b408-45cf0afc68e5	6df0c398-c516-42c0-8ec8-44b80b6a7e13	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
e104b19f-b403-402b-a1d0-6ec77dcbb8d5	bffbe245-1708-4ca0-9d47-71076468639e	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_4.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
e12760fd-f21d-4041-8b8e-09c520e95c1c	331cfe79-50f3-4d7a-b985-3d1bd4d21711	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_2.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
e18d7c33-a580-4502-a304-7b3a6f6e9085	93bbdffb-903a-47e6-8c13-a5f8473fb19b	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
e1becef6-9e32-4865-b672-3875c4466391	6df0c398-c516-42c0-8ec8-44b80b6a7e13	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
e208ce15-d7f2-4f13-bdcd-d09d99365820	00cab774-035f-42d6-938f-966edd90c390	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
e29413dd-cdd1-4f88-950d-733756cc810d	5426d1e1-dde5-4842-8959-5753a47ffe73	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_35.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
e2aa0b28-d212-4e23-bf9d-26f93069c610	c69d3460-b4bb-4165-a095-57ff211c4f6a	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_11.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
e2dddb27-c41f-40ff-b238-49439a8f72d8	65d39ecd-061e-4d69-9f04-3e762b4f1931	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
e39a27ce-0a3e-4bde-86da-12bae60c2849	e82b5601-8cef-41ca-ae3b-cc3fc07745e5	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_24.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
e425f1e2-ef62-4ba3-80fc-ebb06a014580	d1c588e5-ee46-42ed-86cf-558355c76ae0	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_39.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
e4850a24-851d-4f81-841b-be7dc3c3dd98	c38fe28d-0479-4c30-b54a-70b9694691fb	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
e548c347-c70c-458d-a4d8-38aa45300a48	6e897788-cfb4-4c3c-a812-fa0a4848f0b3	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
e5a6463e-c4f6-45d2-93a3-053539bc7433	728cc8a6-1a2f-4f90-9932-8aefbff75847	Card Wars Finn vs Jake/Финн/cuts/finn_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
e6902187-7ff8-43aa-85b3-e2167f46e36d	ef93e0c1-7333-47fc-a77a-d5d28972054c	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
e6c4e626-ecf5-43a7-9182-8a639fdc42a3	186834c2-3c54-4557-a005-046228fb9094	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_6.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
e7cdf03d-e821-47b9-82f0-cad1e1fcea47	7bd1dbe1-1036-4e6d-ba52-56e6f1f65842	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_29.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
e7df099f-2ba4-49f5-9250-504a05e9753b	bffbe245-1708-4ca0-9d47-71076468639e	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_3.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
e802a190-b179-4815-9163-19d1d415dad9	235c0a23-caff-488e-91f4-2d52793ed03c	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
e8e265cd-b562-4cf6-861f-6ca72e3e6b18	ee0caf1c-bacf-4a70-be2a-48de76fffdd2	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
e8fb3ce4-e480-4a20-9e1a-016ad84ad56e	91a6434b-c439-4d59-b384-7691aa5b2136	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
e91e7eb0-4c05-4fc0-97fa-06bf0515b4ec	ce410124-147c-4276-9057-d9b93d96a5b7	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_34.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
ea00c814-0aa4-4350-bca9-a898e59d6d4b	643302f9-f208-4706-a466-dc441838013c	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
ea3a059b-2cd7-41c3-98fc-060f2f244676	a7ddb739-d528-4430-a6f6-85ecbd6fd7be	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
eabc60cd-3847-4484-8c0a-90b853d2f5bd	03082b08-4731-612d-52c3-0837ac27fe52	Card Wars Finn vs Jake/Джейк/cuts/jake_card_38.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
ec93b555-f8f8-4ff4-a961-0531dcdc66e1	38685a02-8a09-428c-8918-493bce7e3c33	Card Wars Fiona vs Cake/кейк/cuts/cake_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
ed129c51-9553-4bf4-b9c0-777f53ae4e4e	ee509393-99c3-4a16-a611-ef14eba5bdc9	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_37.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
ed8153ea-c666-489e-8083-f408a8a0373a	37025e60-4377-4017-bb29-3e53fc9ab470	Card Wars Princess Bubblegum vs Lumpy Space Princess/Пупырка/cuts/lsp_card_13.png	local	t	\N	\N	\N	2026-08-11 13:57:42.15497+00
edf46b4f-fe29-4f0c-a543-7f81c08581fb	9c6c4e76-d2ce-4800-80ef-a63e1ee79e20	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
ee565e7e-b058-4d48-81cc-b313dd32dbe7	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	Card Wars Finn vs Jake/Джейк/cuts/jake_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
ee5e8273-9857-4b0c-87cb-230296e1e626	c066bcfd-cb90-488d-ab94-d54e6d3e7271	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_19.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
eebc510d-5191-4503-bbd8-f45416f71950	2bebdc5d-e74c-43f3-9e60-54f43ecc4000	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
eee79e8a-a5fc-4eea-8569-b47aa1e8202d	5b9db681-bf83-402b-84e3-8a162686fef3	Card Wars Ice King vs Marceline/Снежный/cuts/ice_king_card_18.png	local	t	\N	\N	\N	2026-08-11 13:57:37.124351+00
ef30b2ab-67e6-47ec-8dba-83df21a21018	90cbf716-9b68-444a-9b72-e698e80689da	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_27.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
f0fe2eeb-d4a9-4302-94ea-2a9e745daa01	2235fc0b-6c63-4d75-8aa0-d886f332f8d9	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
f1f8ccb4-c7b9-4ae9-a652-94e4aca11222	ede6a57c-eac8-493d-86fa-d7c8569c6e98	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
f28fbbb1-c2d4-4daa-b5ad-fffdb2c0bbdb	4ac368b2-ec89-455f-8a54-a4e86bf4f4f0	Card Wars Doubles Tournament/Doubles Tournament/Моника/cuts/monika_card_5.png	local	t	\N	\N	\N	2026-08-11 13:57:45.836251+00
f3a7f5ef-b851-4387-ac0b-720b8132a1c0	c46d6947-0e5c-4813-86b4-9cfd94726cba	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_17.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
f3ca82bd-e0b4-494a-b28e-2bda68850398	ee3a33d6-cfbd-4922-a94f-5bbe6721ddf2	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_30.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
f44fb6d4-329e-451a-9965-f40ac3fcc164	d49826b4-12f6-fc29-0258-961dda1f8963	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_28.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
f4b2a2fd-d67b-45ce-b25b-13a1d0c0429d	660470c8-190b-4a91-aef5-e68161f3abeb	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
f55357db-5eb9-43e9-9ab2-f03f4afd6838	871f19a8-6b4c-4db5-85c2-dba7d319f5d8	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_40.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
f5c2db6c-c7a6-405b-8b75-c48607d998f1	9b558a9f-01ce-4e72-9bc6-b2c2d8e7c4d8	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
f704d327-072f-4514-a791-675206827c96	3f060748-f1c0-4731-9c8f-9949546e7093	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
f8326913-303c-4329-b4ad-d1309a954111	cd8b183d-9c9d-4d2e-b093-ec866b7e7a44	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_10.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
f951c04f-419e-452b-88f1-dc8320ec45d8	0814a527-e3f0-481e-991c-6e1ec6a562ab	Card Wars Finn vs Jake/Финн/cuts/finn_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
fa371be1-0d9e-4601-a233-848dc29d8907	12cc7479-32f0-f341-2b04-13a94516466f	Card Wars Fiona vs Cake/кейк/cuts/cake_card_21.png	local	t	\N	\N	\N	2026-08-11 13:57:31.641532+00
fa896d6e-a6a1-4a87-93b7-4575cba0360f	c066bcfd-cb90-488d-ab94-d54e6d3e7271	Card Wars Doubles Tournament/Doubles Tournament/ГранПри/cuts/grand_prix_card_20.png	local	t	\N	\N	\N	2026-08-11 13:57:35.392727+00
fadc59d7-3f4d-4203-87f9-6fbbd8db0340	f51ce835-5c07-4eaf-bbe6-b7cb5c6fac2f	Card Wars Doubles Tournament/Doubles Tournament/Чарли/cuts/charlie_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:32.504355+00
fb0c0684-d88f-4b9d-a90d-b1790c0e6d35	524d05a1-6fb5-194d-ec31-9f041a4ce29d	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
fb2872a9-98fb-4abd-9e68-2c0904186481	d3453e07-908b-43c1-a169-65a04f4ba779	Card Wars Princess Bubblegum vs Lumpy Space Princess/Бубльгум/cuts/bubblegum_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:30.670008+00
fbb286c1-eee7-4ff0-ab1b-17008571d9da	4ad8fa44-8f54-42bf-892c-bc1e3a4104b4	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_33.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
fcabfeed-9cb3-4979-ac77-fcdad17cb1b3	1399b830-2a53-4910-a328-97da938c229e	Card Wars BMO vs Lady Rainicorn/Леди Ливнерог/cuts/lady_rainicorn_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:40.148098+00
fcb23e6e-6f65-4753-9b14-638fbd38d0c2	f7a97331-86d8-47f3-89cc-092e6e91d6f1	Card Wars Finn vs Jake/Джейк/cuts/jake_card_7.png	local	t	\N	\N	\N	2026-08-11 13:57:37.949578+00
fcceed98-605e-4a2f-ab30-025c8d10c871	e408acdf-7b80-71f8-cd11-9f79c9d6a4d7	Card Wars Finn vs Jake/Финн/cuts/finn_card_26.png	local	t	\N	\N	\N	2026-08-11 13:57:33.544503+00
fcd031e4-c866-4876-a6a3-0a918134ea48	7e52d9a4-1c3b-3f1b-5dc8-7169fb82b7ab	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_32.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
fd240cce-d277-4821-a45a-3d296d71e838	b377455b-733e-401d-9a97-60da5b6c9772	Card Wars Ice King vs Marceline/Марселин/cuts/marceline_card_15.png	local	t	\N	\N	\N	2026-08-11 13:57:43.375528+00
fda97ecc-b163-4653-9ad0-b5bb4a5106ff	dafe14f2-d6ef-4d91-9da5-79e0286fa195	Card Wars Lemongrab vs Gunter/гантер/cuts/gunter_card_14.png	local	t	\N	\N	\N	2026-08-11 13:57:36.257339+00
fe0b92e0-a237-471e-b812-493caff64de7	b6c06e74-a2e8-4e80-9128-1eeff3d7cc5e	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_31.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
fe441fbe-3e3f-4eca-8ffd-b440c37ccb15	31bbfe76-12a9-4161-823f-d7fad12c77a2	Card Wars Lemongrab vs Gunter/лемонхват/cuts/lemongrab_card_23.png	local	t	\N	\N	\N	2026-08-11 13:57:41.212264+00
ff5be76a-d84f-40f8-b94f-71bb2b2b7932	b892b2b6-c971-4042-a758-92ed9296f38a	Card Wars BMO vs Lady Rainicorn/БиМО/cuts/bmo_card_36.png	local	t	\N	\N	\N	2026-08-11 13:57:28.083849+00
ffaf4db9-f1f4-4e57-b644-7d04c993067e	1609e63b-ea3e-ef12-95ee-c430fce78726	Card Wars Fiona vs Cake/фионна/cuts/fiona_card_9.png	local	t	\N	\N	\N	2026-08-11 13:57:34.518028+00
ffecb8b8-266a-4485-ae7b-ef1882aa2e8e	b45304e2-3a31-4ed4-ac71-6218ba1643f6	Card Wars Doubles Tournament/Doubles Tournament/Джейк 2v2/cuts/jake_2v2_card_8.png	local	t	\N	\N	\N	2026-08-11 13:57:39.313613+00
\.


--
-- Data for Name: cards; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cards (id, card_number, name, description, card_type, cost, attack, health, has_flip, flip_description, mechanics, image_url, created_at, updated_at, land_type, is_rainbow, rarity, source, hero, notes) FROM stdin;
00286762-cca6-42a1-a904-ff9e2fc20b3a	302	Рубленный стейк	В начале твоего хода сбрось 2 карты или уничтожь Рубленый стейк. (Сброс после начального взятия карты.)	creature	1	4	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/00286762-cca6-42a1-a904-ff9e2fc20b3a.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	swamp	f	\N	\N	\N	\N
0073f310-c153-483d-9c7f-c0c5a465ac61	79	Жнец	Дополнительная плата: сбрось карту. Когда Жнец вступает в игру, перемести существо на этой линии на пустую соседнюю линию (на своей стороне).	creature	2	1	12	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0073f310-c153-483d-9c7f-c0c5a465ac61.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:48:52.253741+00	corn	f	\N	\N	\N	\N
00cab774-035f-42d6-938f-966edd90c390	393	Яростная наседка	Яростная цыпа получает +1 ATK за каждую единицу урона на ней.	creature	2	0	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/00cab774-035f-42d6-938f-966edd90c390.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	good	f	\N	\N	\N	\N
01d41265-814d-4b9d-8856-6b9ef0f09739	382	Черничная Джинни	Когда Черничная Джинни вступает в игру замени существо, тянь две карты.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/01d41265-814d-4b9d-8856-6b9ef0f09739.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	\N	\N	\N
02dd3f6e-956a-e2b8-a8d0-8520a39563a2	114	Колдунья кукурузы	Колдунья кукурузы получает +1 ATK за каждое другое Кукурузное существо под твоим контролем.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/02dd3f6e-956a-e2b8-a8d0-8520a39563a2.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	corn	f	\N	CP1	Jake	\N
02ebf806-906c-49a6-8fef-7881087ce1c3	283	Последний раунд!	Выбранное существо под твоим контролем получает +2 ATK за каждое неактивное существо под твоим контролем (на момент вступления в игру).	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/02ebf806-906c-49a6-8fef-7881087ce1c3.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	any	t	\N	\N	\N	\N
03082b08-4731-612d-52c3-0837ac27fe52	21	Великолепный замок	Твое существо получает +3 DEF на этой линии.	building	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/03082b08-4731-612d-52c3-0837ac27fe52.png	2026-08-11 13:56:54.669194+00	2026-08-16 18:45:19.148455+00	any	t	\N	CP1	Jake	\N
03765705-5e6c-4fb8-bfd0-9f022aaad97b	203	Мороженная рыба	Когда Мороженная рыба наносит урон существу, можешь заморозить землю на этой линии.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/03765705-5e6c-4fb8-bfd0-9f022aaad97b.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	ice	f	\N	\N	\N	\N
0612c379-8d7c-4ec0-ac73-0e3fca13cf85	349	Ты жжошь!	Переверни выбранную землю лицом вниз до начала твоего следующего хода.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0612c379-8d7c-4ec0-ac73-0e3fca13cf85.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	any	t	\N	\N	\N	\N
0764e611-45e9-4691-b478-1ca39de3534a	326	Снежный пес	ПРИЕМ >>> Каждое соседнее существо получает +2 ATK.	creature	2	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0764e611-45e9-4691-b478-1ca39de3534a.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	ice	f	\N	\N	\N	\N
0814a527-e3f0-481e-991c-6e1ec6a562ab	130	Кровь Вайда	Каждое существо, сменившее линию в этом ходу, получает +2 ATK.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0814a527-e3f0-481e-991c-6e1ec6a562ab.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	any	t	\N	\N	\N	\N
091f42b0-e27e-43f8-9efa-a4f98c64567c	341	Сэндвич с мороженым	Потрать 1 Действие, ПРИЕМ >>> Выбери линию и заморозь обе земли на ней.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/091f42b0-e27e-43f8-9efa-a4f98c64567c.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	ice	f	\N	\N	\N	\N
0a0967c7-9e13-48dc-b54a-bb5476c024a1	87	Замороженное сердце	Нанеси 1 Урон выбранному существу. Если это существо на земле с ледяным жетоном, то вместо 1 нанеси 3 Урона.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0a0967c7-9e13-48dc-b54a-bb5476c024a1.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	any	t	\N	\N	\N	\N
0a623ca1-1d49-42b3-a18d-26feafd59da1	211	Мягкий рекрут	Когда Мягкий рекрут вступает в игру и у противника на этой линии нет существ под его контролем, получи 1 Действие.	creature	1	2	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0a623ca1-1d49-42b3-a18d-26feafd59da1.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	ice	f	\N	\N	\N	\N
0bfde5fe-962c-4cac-8786-41306887d08b	93	Защищенный зебрагон	Когда Защищенный зебрагон атакует, можешь восстановить 1 урон у соседнего существа.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0bfde5fe-962c-4cac-8786-41306887d08b.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	corn	f	\N	\N	\N	\N
0c1e3fa7-8634-4a70-a97f-e2fc5c84bf8c	294	Радужное партнерство	В первый раз когда твой партнер сыграет Радужное заключение или строение, в этот же ход ты можешь сыграть заключение или строение стоимости того же самого типа бесплатно.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0c1e3fa7-8634-4a70-a97f-e2fc5c84bf8c.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	any	t	\N	\N	\N	\N
0cd6e56f-4e7c-43bb-a73b-d2ff44b9b3c2	238	Отражение угрозы	Перемести 3 и менее урона с существа под твоим контролем на выбранное существо противника на этой линии.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0cd6e56f-4e7c-43bb-a73b-d2ff44b9b3c2.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	blue	f	\N	\N	\N	\N
0d22812a-1ff3-4fbd-8364-76ab7c5049f3	241	Офицер ириска	Каждый раз когда земля замораживается, тяни карту.	creature	2	2	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0d22812a-1ff3-4fbd-8364-76ab7c5049f3.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	ice	f	\N	\N	\N	\N
0d558d38-931d-49e4-a745-a5421139d762	304	С добрым утром!	Подготовь каждое существо под твоим контролем.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0d558d38-931d-49e4-a745-a5421139d762.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	blue	f	\N	\N	\N	\N
0d85f09f-1e0d-c402-08cf-63e7a3aa73f3	73	Древний школяр	ПРИЕМ >>> Верни случайную Радужную карту из своей стопки сброса себе в руку. Если на этой линии Контролируешь существо, получи 1 действие.	creature	1	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0d85f09f-1e0d-c402-08cf-63e7a3aa73f3.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	blue	f	\N	CP1	Finn	\N
0dc32317-e17e-49c4-b903-5c8373c392c9	95	Зебрагон на подборе	+1 ATK за каждый различный тип земли под твоим контролем.	creature	1	0	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0dc32317-e17e-49c4-b903-5c8373c392c9.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	corn	f	\N	\N	\N	\N
0e6a2530-245b-423f-a62b-54b63e17fbe3	136	Крок-поработитель	Существо противника на этой линии получает -1 DEF за каждые 5 карт в твоей стопке сброса.	creature	2	3	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/0e6a2530-245b-423f-a62b-54b63e17fbe3.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	swamp	f	\N	\N	\N	\N
10093d14-96b1-4e1e-a559-899f018080a0	372	Хороший песик	Сбрось карту >>> Хороший песик получает +2 ATK в этом ход. (Используй только один раз в каждый свой ход.)	creature	0	0	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/10093d14-96b1-4e1e-a559-899f018080a0.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	any	t	\N	\N	\N	\N
1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	126	Крепость Крови	Твоё существо получает +1 ATK на этой линии.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	any	t	\N	CP1	Jake	\N
12a58dc9-dcc6-4b2e-85dc-e7231837019c	273	Пляжная мумия	ПРИЕМ >>> Верни существо на соседней линии в руку владельцу.	creature	1	0	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/12a58dc9-dcc6-4b2e-85dc-e7231837019c.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
12cc7479-32f0-f341-2b04-13a94516466f	152	Кукурузный тамплиер	ПРИЕМ >>> Восстанови 1 урон у Кукурузного тамплиера.	creature	1	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/12cc7479-32f0-f341-2b04-13a94516466f.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	CP6	Cake	\N
132e1c0f-0386-4e06-9a7c-0b1a7c061cbf	213	Мясной кулак	Выбранное существо под твоим контролем получает -5 ATK в этом ходу. Тяни карту.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/132e1c0f-0386-4e06-9a7c-0b1a7c061cbf.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
136f3e07-e8ec-49dd-8759-b4c8eee8317a	346	Тоштомный клон	Уничтожь Тошнотного клона >>> Уничтожь выбранное Существо противника на этой линии и любое существо с таким же именем в игре.	creature	2	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/136f3e07-e8ec-49dd-8759-b4c8eee8317a.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	swamp	f	\N	\N	\N	\N
1399b830-2a53-4910-a328-97da938c229e	262	Песчаный змей	Когда Песчаный змей вступает в игру, нанеси 4 урона выбранному существу противника на этой линии.	creature	1	0	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1399b830-2a53-4910-a328-97da938c229e.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
140365b7-588f-4fe2-8431-f9ee4f9eb1e5	89	Заплатка	Перераспредели урон на существах под твоим контролем (сделай это так, чтобы урона было не больше DEF).	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/140365b7-588f-4fe2-8431-f9ee4f9eb1e5.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	good	f	\N	\N	\N	\N
143a0f28-6ee1-4da0-ab19-fa3da7085fab	235	Остров головокруба	Потрать 1 действие, ПРИЕМ >>> Если эта земля пустая, то открой карты с верха своей колоды до тех пор, пока не найдешь Существо, сыграй его бесплатно на эту землю и замешай открытые карты обратно в свою колоду.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/143a0f28-6ee1-4da0-ab19-fa3da7085fab.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	sand	f	\N	\N	\N	\N
14808116-18a1-4c69-8fa6-cc4c913bea1e	83	Заманчивое Спа	Если в начале твоей фазы Сражения, у тебя под контролем есть неактивное существо на этой земле, вытяни карту.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/14808116-18a1-4c69-8fa6-cc4c913bea1e.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	blue	f	\N	\N	\N	\N
155186bc-e508-4562-a18f-216be9796752	195	Милозавр Рекс	Если в начале твоего хода на Хлопкозавре Рексе есть урон, тяни карту.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/155186bc-e508-4562-a18f-216be9796752.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	good	f	\N	\N	\N	\N
15d3a16b-40e0-4fdb-8782-1a633f9f6411	4	Акула	Когда песчаное существо вступает в игру во время твоего хода (включая Акулу), оно получает +1 ATK в этом ходу.	creature	2	2	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/15d3a16b-40e0-4fdb-8782-1a633f9f6411.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	sand	f	\N	\N	\N	\N
1609e63b-ea3e-ef12-95ee-c430fce78726	200	Младший школяр	Если в этом ходу ты сыграл хотя бы одну Радужную карту, Младший школяр получает +3 АТК в этом ходу.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1609e63b-ea3e-ef12-95ee-c430fce78726.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	blue	f	\N	CP6	Fiona	\N
1663ae32-8957-4c03-b9b7-df5a5d443500	216	Мятный змей	Когда Мятный змей наносит урон противнику, можешь восстановить столько же HP (но не более 25).	creature	1	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1663ae32-8957-4c03-b9b7-df5a5d443500.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	good	f	\N	\N	\N	\N
16b96fe2-455c-4c3f-a346-e4fdf3e43432	157	Ласковая овечка	Если в начале твоего хода у Ласковой овечки 4 урона и более, нанеси 2 урона выбранному существу противника на этой линии.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/16b96fe2-455c-4c3f-a346-e4fdf3e43432.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:05.12985+00	good	f	\N	\N	\N	\N
1716abfd-b0b1-414f-84f1-82ee005928f6	111	Козел	Когда Козел вступает в игру замени существо, тянь карту.	creature	0	1	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1716abfd-b0b1-414f-84f1-82ee005928f6.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	any	t	\N	\N	\N	\N
184a0b61-8f24-4ac1-8986-b727929130a7	25	Библия	Выбери карту из открытой колоды. Выбранный игрок открывает свою колоду. Если стоимости карт совпадают, собери оба.	spell	0	0	0	f	\N	[]		2026-08-11 13:56:54.669194+00	2026-08-16 18:46:15.936028+00	any	t	\N	\N	\N	\N
18536825-81ef-1a3f-a7b2-c66c10a52523	298	Река мечей	Каждое существо под твоим контролем получает +2 ATK в этом ходу. Тяни 2 карты.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/18536825-81ef-1a3f-a7b2-c66c10a52523.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	any	t	\N	CP6	Fiona	\N
186834c2-3c54-4557-a005-046228fb9094	379	Цитадель с куполом	Твоё существо на этой линии получает +2 DEF и не может быть повреждено заклинанием противника.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/186834c2-3c54-4557-a005-046228fb9094.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	\N	\N	\N
18926068-66e9-4c54-b195-2a6fc8b55446	30	Болотое партнерство	В начале твоего фазы бродячего заклинания, его стоимость равна числу твоих союзных болотных заклинаний и болотных строений.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/18926068-66e9-4c54-b195-2a6fc8b55446.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
18f43003-491f-378c-1dc2-6daed587d8dd	282	Попкорн-бабочка	ПРИЕМ >>> Тяни карту за каждое строение под твоим контролем.	creature	1	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/18f43003-491f-378c-1dc2-6daed587d8dd.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	corn	f	\N	CP6	Cake	\N
192b3884-2643-4185-bea7-2b59ff423295	117	Корова	Муу.	creature	0	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/192b3884-2643-4185-bea7-2b59ff423295.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	any	t	\N	\N	\N	\N
196e641f-20be-4577-bf49-179abe0284aa	51	Вулкан	Уничтожь выбранное строение. Можешь нанести 3 урона существу на этой линии. Переверни лицом вниз свою землю на этой линии.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/196e641f-20be-4577-bf49-179abe0284aa.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
19bb7834-b488-4cde-a33e-fec3684c4466	174	Ледяной лимонад	Сосчитай количество земель с Ледяными жетонами. Восстанови 1 урон с такого же количества дружественных существ.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/19bb7834-b488-4cde-a33e-fec3684c4466.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
19c2c236-8e9a-4ec9-b7e2-83cf395af342	389	Школяр будущего	Когда Школяр будущего вступает в игру замени существо, получи 1 Действие.	creature	2	2	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/19c2c236-8e9a-4ec9-b7e2-83cf395af342.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	any	t	\N	\N	\N	\N
1b7ae872-9779-4c5b-9521-a148f378f0e3	291	Пурга	Выбери линию и заморозь обе земли на ней.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1b7ae872-9779-4c5b-9521-a148f378f0e3.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	ice	f	\N	\N	\N	\N
1b8510d7-a8af-4570-b22c-4b6f40bd577f	156	Лакость	Выбери двух игроков. Каждый открывает случайную карту с руки. Если их стоимость не совпадает они сбрасывают эти карты.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1b8510d7-a8af-4570-b22c-4b6f40bd577f.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:05.12985+00	any	t	\N	\N	\N	\N
1b8a452b-2a5f-48dd-ab15-8bfa0559a8df	251	Персиковая Джинни	Когда песчаное существо вступает в игру под твоим контролем, Персиковая Джинни получает +1 ATK в этом ходу.	spell	0	0	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1b8a452b-2a5f-48dd-ab15-8bfa0559a8df.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
1bf7dd87-3e2e-4901-a991-69e353d62d70	124	Кот-панк	Каждое существо, сменившее линию в этом ходу, получает +2 ATK в этом ходу.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1bf7dd87-3e2e-4901-a991-69e353d62d70.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	blue	f	\N	\N	\N	\N
1cfc52a9-c7a7-4cd8-9847-3cfe8069a012	350	Тёмный ангел	+1 ATK за каждые 5 карт в твоей стопке сброса.	creature	1	0	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1cfc52a9-c7a7-4cd8-9847-3cfe8069a012.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	swamp	f	\N	\N	\N	\N
1db4f266-5b6f-4e88-a9c1-122719af76fb	255	Песочный замок	Сбрось Песочный замок из игры >>> Возьми свое существо на этой земле в руку и сыграй его бесплатно.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1db4f266-5b6f-4e88-a9c1-122719af76fb.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
1e3e2aac-f1eb-b0e9-cdcf-bd1b6948834b	104	Кадеты	Другие твои существа на этой линии получают +1 ATK.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1e3e2aac-f1eb-b0e9-cdcf-bd1b6948834b.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	blue	f	\N	CP1	Finn	\N
1ec9e57b-2a39-fe2e-813e-562f7ac501f0	242	Очаровательный город	Все существа на этой линии теряют свой тип Земли и становятся Радужными существами.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1ec9e57b-2a39-fe2e-813e-562f7ac501f0.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	blue	f	\N	CP6	Fiona	\N
1f2150d0-d86c-4a51-9b53-c32797a15e8d	24	Бессмертный ходок маиса	Пока Бессмертный ходок маиса на Кукурузной земле, он наносит тройной урон.	creature	2	2	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1f2150d0-d86c-4a51-9b53-c32797a15e8d.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	swamp	f	\N	\N	\N	\N
2fa57040-8e36-4191-96ef-1f38674f62ee	175	Липкий мозг	Когда Липкий мозг вступает в игру замени существо, он получает +2 ATK в этом ход.	creature	1	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2fa57040-8e36-4191-96ef-1f38674f62ee.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	\N	\N	\N
1f767596-ec9e-43a2-bfca-75dffdc63355	44	Велик на двоих	Выбери существо под твоим контролем и верни его на руку владельцу. Выбери другого игрока. Он выбирает существо под его контролем и возвращает его на руку. Он выбирает существо под его контролем и возвращает его на руку владельцу.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/1f767596-ec9e-43a2-bfca-75dffdc63355.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
20c9d426-ad07-4207-a37b-c5a26a0d672d	272	Пляжная вечеринка	Открой 3 верхние карты своей колоды. Как сделал это, можешь сбрось. Как сделал это, можешь вложить Пляжную вечеринку в руку.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/20c9d426-ad07-4207-a37b-c5a26a0d672d.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	any	t	\N	\N	\N	\N
20cff4aa-ae37-4a35-be39-df7738bb2361	194	Милашка коала	Пока у Милашки коалы 4 урона и более, она получает +2 ATK.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/20cff4aa-ae37-4a35-be39-df7738bb2361.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	good	f	\N	\N	\N	\N
211eb1c6-bd7f-4514-8b40-85cf63408c0d	42	Вафля в шоколаде	Если в начале твоей фазы сражения на этой линии есть хотя бы один Ледяной жетон, нанеси 1 урона каждому существу под контролем выбранного игрока.	creature	2	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/211eb1c6-bd7f-4514-8b40-85cf63408c0d.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	ice	f	\N	\N	\N	\N
21df0e5f-d10a-4bee-9292-c895ff975d93	47	Вождь Вайда	Вождь Вайда получает +2 ATK за каждое сыгранное тобой заклинание в этом ходу.	creature	2	1	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/21df0e5f-d10a-4bee-9292-c895ff975d93.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	blue	f	\N	\N	\N	\N
2235fc0b-6c63-4d75-8aa0-d886f332f8d9	137	Крок-эколог	Когда Крок-эколог на Ледяной земле, он получает +2 ATK.	creature	1	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2235fc0b-6c63-4d75-8aa0-d886f332f8d9.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	swamp	f	\N	\N	\N	\N
235c0a23-caff-488e-91f4-2d52793ed03c	323	Снежный ангел	ПРИЕМ >>> Восстанови 1 Урон с каждого своего существа за каждую землю с ледяным жетоном под контролем игроков.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/235c0a23-caff-488e-91f4-2d52793ed03c.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	ice	f	\N	\N	\N	\N
24cfe0c8-eab4-8e69-cc95-621af614e353	342	Талисман Вайда	Выбери существо Голубых равнин под твоим контролем, оно получит +2 ATK в этом ходу.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/24cfe0c8-eab4-8e69-cc95-621af614e353.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	any	t	\N	CP1	Jake	\N
251a7ad5-6f2f-42ca-a2ac-71f26e70a758	233	Ослепительная Люси	Ослепительная Люси получает +1 ATK за каждую землю с ледяным жетоном под контролем игроков.	creature	2	2	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/251a7ad5-6f2f-42ca-a2ac-71f26e70a758.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	ice	f	\N	\N	\N	\N
28eda665-0626-4aaf-8073-e05d22aed99f	240	Офигительные штаны	Перемести выбранное существо под твоим контролем на пустую Голубую равнину под твоим контролем, затем тяни карту.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/28eda665-0626-4aaf-8073-e05d22aed99f.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	blue	f	\N	\N	\N	\N
2949a9cf-7560-422e-beb3-e27e0e83a920	159	Легкий жираф	Пока у Легкого жирафа 4 урона и более, он наносит урон непосредственно противнику вместо существа противника.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2949a9cf-7560-422e-beb3-e27e0e83a920.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:05.12985+00	good	f	\N	\N	\N	\N
29ac0a01-d149-0707-d649-9bc690d1df9d	383	Чокнутая кошатница	Твои Радужные существа получают +1 АТК.	creature	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/29ac0a01-d149-0707-d649-9bc690d1df9d.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	CP6	Fiona	\N
2b2f3937-b9da-406a-be35-ec001e1c607e	309	Серая мышь	Потрать 1 действие >>> Верни случайное болотное существо из своей стопки сброса себе в руку.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2b2f3937-b9da-406a-be35-ec001e1c607e.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	swamp	f	\N	\N	\N	\N
2bb706a3-9791-45f8-a367-6225705d8085	54	Газы Огра	Открой 3 карты сверху своей колоды. Одну положи вниз своей колоды, остальные две сбрось.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2bb706a3-9791-45f8-a367-6225705d8085.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	any	t	\N	\N	\N	\N
2bebdc5d-e74c-43f3-9e60-54f43ecc4000	161	Ледяная бомбардировка	Уничтожь выбранное существо на земле с Ледяным жетоном.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2bebdc5d-e74c-43f3-9e60-54f43ecc4000.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
2c5bd0ce-b966-4e47-88a9-5745f38f7053	37	Бригадир десерт	Когда Бригадир десерт атакует, нанеси 2 урона выбранному Существу противника на земле с Ледяным жетоном.	creature	2	3	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2c5bd0ce-b966-4e47-88a9-5745f38f7053.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	ice	f	\N	\N	\N	\N
2d073746-6718-4c18-aa7f-e666a4d92a1c	32	Большой курятник	В начале твоего хода нанеси 1 или 2 Урона своему существу на этой линии, затем восстанови 1 HP (максимум 25).	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2d073746-6718-4c18-aa7f-e666a4d92a1c.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	good	f	\N	\N	\N	\N
2d151e22-1051-4499-aed7-1ba60dd23876	247	Пентапластырь	Восстанови ровно 5 урона с существа под твоим контролем (ни больше, ни меньше).	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2d151e22-1051-4499-aed7-1ba60dd23876.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	good	f	\N	\N	\N	\N
2fe32de8-ac6d-4e9c-b959-47fc8089301b	182	Лысый заседатель	Сбрось карту >>> Восстанови 1 Урон с Лысого заседателя. (Используй только один раз в каждый свой ход.)	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2fe32de8-ac6d-4e9c-b959-47fc8089301b.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	swamp	f	\N	\N	\N	\N
2ffb81ee-0b37-40ca-a114-99ce544d6a8f	267	Пироклон	Когда Пироклон вступает в игру, восстанови 1 урон с каждого соседнего существа.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/2ffb81ee-0b37-40ca-a114-99ce544d6a8f.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	good	f	\N	\N	\N	\N
30fd927e-b6f7-40e8-9cd0-794a9c0777c9	344	Тонущий клирик	В начале своего хода перемести Тонущего клирика на пустую землю под твоим контролем. Если не смог, то сбрось его.	creature	1	3	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/30fd927e-b6f7-40e8-9cd0-794a9c0777c9.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	any	t	\N	\N	\N	\N
315984b2-6321-4c3e-b46a-7e6510a2001b	277	Полезный зебрагон	+1 DEF за каждый различный тип земли под твоим контролем.	creature	1	2	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/315984b2-6321-4c3e-b46a-7e6510a2001b.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	corn	f	\N	\N	\N	\N
31bbfe76-12a9-4161-823f-d7fad12c77a2	148	Кукурузный глазастик	+1 DEF за каждую различную землю под твоим контролем.	creature	2	4	1	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/31bbfe76-12a9-4161-823f-d7fad12c77a2.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	\N	\N	\N
31dee8e7-d0ae-4f8a-897c-85ea95dcf56b	347	Тренированный крылатый зебрагон	+1 ATK за каждую Тимворк под контролем твоего колоды. Если Тренированный крылатый зебрагон покидает игру во время твоей фазы сражения, можешь положить в свою руку.	creature	2	3	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/31dee8e7-d0ae-4f8a-897c-85ea95dcf56b.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	corn	f	\N	\N	\N	\N
331cfe79-50f3-4d7a-b985-3d1bd4d21711	184	Магазин для отдыха	ПРИЕМ >>> Перемести неактивное существо под твоим контролем на эту землю (если она пустая).	building	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/331cfe79-50f3-4d7a-b985-3d1bd4d21711.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	\N	\N	\N
33c624b0-7bc3-43df-8838-e11eca58a33f	324	Снежный бизнес	Потрать 1 действие >>> Заморозь выбранную землю на этой линии.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/33c624b0-7bc3-43df-8838-e11eca58a33f.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	ice	f	\N	\N	\N	\N
35178668-42aa-42d0-8092-d81804201449	253	Пескозавр рокс	+2 ATK за каждую твою пустую землю.	creature	2	0	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/35178668-42aa-42d0-8092-d81804201449.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
37025e60-4377-4017-bb29-3e53fc9ab470	123	Костяная рука	ПРИЕМ >>> Сбрось 3 верхние карты своей колоды. За каждое заклинание сброшенное таким образом, выбранный игрок сбрасывает карту.	creature	2	3	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/37025e60-4377-4017-bb29-3e53fc9ab470.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	swamp	f	\N	\N	\N	\N
38685a02-8a09-428c-8918-493bce7e3c33	336	Стрелец Дэника	Уничтожь Строение под твоим контролем, ПРИЕМ >>> Нанеси 3 урона каждому существу противника.	creature	2	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/38685a02-8a09-428c-8918-493bce7e3c33.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	corn	f	\N	\N	\N	\N
3986cfe7-f862-4e18-a762-af7e6b6f999e	377	Царь полей	Царь полей получает +1 ATK за каждое другое Кукурузное существо под твоим контролем.	creature	1	0	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3986cfe7-f862-4e18-a762-af7e6b6f999e.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	corn	f	\N	\N	\N	\N
3a377408-57fd-4a20-a8a7-da6f2b3fef03	299	Робомансер	+1 ATK за каждое существо, сменившее линию во время твоего хода.	creature	2	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3a377408-57fd-4a20-a8a7-da6f2b3fef03.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	blue	f	\N	\N	\N	\N
3ac0ad44-4705-4258-9d12-6701ed7b75ed	20	Белкобомбы	Выбранный враг может сбросить карту. Если нет, то нанеси 2 Урона каждому его существу.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3ac0ad44-4705-4258-9d12-6701ed7b75ed.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	swamp	f	\N	\N	\N	\N
3ac700eb-8c26-42b3-84bd-4ef56d2bd323	316	Скелет гастролёр	ПРИЕМ >>> Скелет гастролёр и другое существо под твоим контролем меняются линиями друг с другом.	creature	1	0	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3ac700eb-8c26-42b3-84bd-4ef56d2bd323.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	blue	f	\N	\N	\N	\N
3af26101-f649-49b7-9aa6-7be25e0d0ac2	128	Кристалл силы	Выбранный игрок тянет 5 карт.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3af26101-f649-49b7-9aa6-7be25e0d0ac2.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	blue	f	\N	\N	\N	\N
3b528d96-b951-fde0-7c6b-d50d7c7095e6	343	Телепорт	Перемести одно из своих существ на одну из своих пустых линий.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3b528d96-b951-fde0-7c6b-d50d7c7095e6.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	any	t	\N	CP1	Finn	\N
3c802983-2343-4e25-bf30-e1041b9bbcba	214	Мясной поп-десапт	Когда Мясной поп-десапт вступает в игру, перемести его на пустую землю, затем переверни эту землю лицом вниз.	creature	2	2	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3c802983-2343-4e25-bf30-e1041b9bbcba.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
3c9e5a67-f07f-4509-b49e-1e585c66f603	356	Уницциклоп	В начале твоего хода каждый игрок тянет карту и затем сбрасывает карту.	creature	2	1	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3c9e5a67-f07f-4509-b49e-1e585c66f603.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:08.749969+00	swamp	f	\N	\N	\N	\N
3d48417c-a22b-4c3c-98ea-79d77f977eb1	261	Песчаный глазастик	Когда Песчаный глазастик вступает в игру, нанеси 1 урон каждому существу в игре (включая каждое твоё существо).	creature	1	3	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3d48417c-a22b-4c3c-98ea-79d77f977eb1.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
3ea5e72a-5a0e-429e-ab82-51bdfbe72ef0	48	Волшебные семена Зазо	Выбранное песчаное существо получает +2 ATK в этом ходу за каждое существо, вступившее в игру на соседнюю линию в этом ходу.	building	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3ea5e72a-5a0e-429e-ab82-51bdfbe72ef0.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
3ecd0a25-be8f-4987-a356-2e2812a1e0ed	6	Амбар с сеном	Потрать 1 Действие, ПРИЕМ >>> Если эта земля пустует, сырай на неё Кормежника из стопки сброса бесплатно. Если Амбар с сеном покидает игру, уничтожь Кормежника на этой земле.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3ecd0a25-be8f-4987-a356-2e2812a1e0ed.png	2026-08-11 13:56:54.669194+00	2026-08-12 12:36:54.374057+00	corn	f	\N	\N	\N	\N
3f060748-f1c0-4731-9c8f-9949546e7093	181	Лысый бродяга	Играй только если под твoим контролем есть существо больных земел. Выбраный противник сбрасывает карту.	spell	0	0	10	f	В начале каждого хода положи верхнюю карту из своей колоды в стопку сброса.	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/3f060748-f1c0-4731-9c8f-9949546e7093.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	\N	\N	\N
42e3f80a-fc68-45b4-b707-fd40fcf511b0	339	Сшитый ленивец	У каждого соседнего существа +1 ATK. Но если у Сшитого ленивца 4 урона и более, то соседние существа получают +2 ATK.	creature	2	0	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/42e3f80a-fc68-45b4-b707-fd40fcf511b0.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	good	f	\N	\N	\N	\N
436d901e-4646-ad9d-de1c-345bef37cbb5	139	Крутой пес	Твои существа на соседних линиях не могут быть атакованы.	creature	2	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/436d901e-4646-ad9d-de1c-345bef37cbb5.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	blue	f	\N	CP1	Finn	\N
43aa094e-74d2-4ff4-9dca-4d20cede6a25	57	Гидромансер	Когда Гидромансер вступает в игру, можешь найти Подмочу и сыграть её бесплатно. Просмотренные карты смешай со своей колодой.	creature	1	3	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/43aa094e-74d2-4ff4-9dca-4d20cede6a25.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	blue	f	\N	\N	\N	\N
4471cb7c-e4e7-4e02-814e-ccd2b10bffd9	292	Пушистая лиса	Пока у Пушистой лисы 4 и более урона, она игнорирует первые 2 урона нанесенные ей существами противника.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4471cb7c-e4e7-4e02-814e-ccd2b10bffd9.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	good	f	\N	\N	\N	\N
45886a9b-ab18-4739-90a0-55780dc7e3b2	55	Геомансер	В начале своего хода можешь переместить Геомансера на пустую землю под твоим контролем.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/45886a9b-ab18-4739-90a0-55780dc7e3b2.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	blue	f	\N	\N	\N	\N
46fd4dc7-669f-49aa-b746-5568cb927919	312	Сила трусов	Выбранное Болотное существо под твоим контролем получает +2 ATK в этом ход.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/46fd4dc7-669f-49aa-b746-5568cb927919.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	any	t	\N	\N	\N	\N
47d56d6b-e909-4d3b-a83f-0d36f3a68165	129	Кристальный дворец	Когда земля на этой линии становится замороженной, нанеси 2 Урона выбранному существу.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/47d56d6b-e909-4d3b-a83f-0d36f3a68165.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	ice	f	\N	\N	\N	\N
496d54a6-3beb-442f-b2b5-f3cc32cc61ce	234	Острая сосулька	Поберегись!	spell	0	3	1	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/496d54a6-3beb-442f-b2b5-f3cc32cc61ce.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
497f133a-cc05-4e3c-aede-e3eb9d43906c	335	Стрелец Дэн	ПРИЕМ >>> Уничтожь выбранное строение на линии Стрельца Дэна.	creature	2	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/497f133a-cc05-4e3c-aede-e3eb9d43906c.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	corn	f	\N	\N	\N	\N
4aba6ef2-c748-451c-a240-1a054578802b	145	Кукурузное партнерство	В начале партнерского хода твоего или твоего партнера, если или партнер сыграл существо стоимостью 2 и более в этом ход, другой партнер может тянуть карту.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4aba6ef2-c748-451c-a240-1a054578802b.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	any	t	\N	\N	\N	\N
4ac368b2-ec89-455f-8a54-a4e86bf4f4f0	173	Ледяной лазутчик	Когда Ледяной лазутчик вступает в игру, заморозь его землю.	creature	0	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4ac368b2-ec89-455f-8a54-a4e86bf4f4f0.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	\N	\N	\N
4ad8fa44-8f54-42bf-892c-bc1e3a4104b4	260	Песчаный ангел	Ложись на песок, подвигай руками и ногами, и она придёт к тебе.	spell	0	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4ad8fa44-8f54-42bf-892c-bc1e3a4104b4.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	any	t	\N	\N	\N	\N
4bb0c695-58d5-4369-9f45-714e86e96d53	35	Бочка	Каждая Бочка получает +1 ATK и +1 DEF за каждую другую Бочку в игре.	creature	0	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4bb0c695-58d5-4369-9f45-714e86e96d53.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
4bfb81ec-b14b-400c-b1ab-c08794ef71d3	293	Радужная мышь	В начале своего хода, восстанови 1 HP за каждый различный тип земли под твоим контролем (но не более 25).	creature	1	1	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4bfb81ec-b14b-400c-b1ab-c08794ef71d3.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	any	t	\N	\N	\N	\N
4cec5560-04d0-45ea-93df-f70aa172c5f1	165	Ледяной Штурмовик	Потрать 1 действие, ПРИЕМ >>> Заморозь выбранную землю.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4cec5560-04d0-45ea-93df-f70aa172c5f1.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
4cf69a10-c61c-49c2-ac09-885cb8dab41c	327	Снежок	Удали Ледяной жетон с земли Снежка >>> Нанеси 3 урона выбранному существу.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4cf69a10-c61c-49c2-ac09-885cb8dab41c.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	ice	f	\N	\N	\N	\N
4d441fb7-162c-40fb-b1f8-418d758274d9	212	Мялое партнерство	Первое существо, которое атакует твое существо в командной ход, получает -1 ATK в этом ход.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4d441fb7-162c-40fb-b1f8-418d758274d9.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	good	f	\N	\N	\N	\N
4d93bb51-fc90-5aaf-7620-0f72f96da306	19	Беликолепный грамофон	Тяни 4 карты, затем сбрось 2 карты.	creature	1	4	2	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4d93bb51-fc90-5aaf-7620-0f72f96da306.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	blue	f	\N	CP6	Fiona	\N
4e4ec732-7060-4c54-1111-8d9de93a6ebc	26	Бизнес пес	Бизнес пес получает +2 АТК за каждую карту сыгранную в этом ходу с "пес" или "щенок" в названии.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4e4ec732-7060-4c54-1111-8d9de93a6ebc.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	blue	f	\N	CP6	Fiona	\N
4edd78fc-8bb7-4767-894f-0c3d06a6ba67	59	Голубая сахарная вата	Восстанови до 3 Урона с выбранного существа под твоим контролем.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4edd78fc-8bb7-4767-894f-0c3d06a6ba67.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	good	f	\N	\N	\N	\N
4f50de13-3714-43be-8bf4-65cffa582670	263	Песчаный сфинкс	ПРИЕМ >>> Верни существо под твоим контролем на этой линии в руку владельцу.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/4f50de13-3714-43be-8bf4-65cffa582670.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
50018881-73b5-72ce-92c0-9455cf4b873b	252	Пес	ПРИЕМ >>> Строения противника в этой линии без текста пока Пес применён.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/50018881-73b5-72ce-92c0-9455cf4b873b.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	any	t	\N	CP6	Fiona	\N
5118435f-a645-480b-b8e5-b081fb37120e	206	Морозильник	Когда Морозильник покидает игру, заморозь его землю.	creature	2	4	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5118435f-a645-480b-b8e5-b081fb37120e.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	ice	f	\N	\N	\N	\N
5153f4c9-6303-4572-bc08-d48a3cf52eae	226	Обнимательный еж	Пока у ЛОбнимашного ежа 4 урона и более, он наносит урон непосредственно противнику вместо существа противника.	creature	2	3	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5153f4c9-6303-4572-bc08-d48a3cf52eae.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	good	f	\N	\N	\N	\N
51c54ef4-99d9-4b84-a1f9-c5a35665a750	352	Тёплый прием	Верни выбранное существо владельцу в руку. Получи количество действий равных её стоимости.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/51c54ef4-99d9-4b84-a1f9-c5a35665a750.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	sand	f	\N	\N	\N	\N
524d05a1-6fb5-194d-ec31-9f041a4ce29d	138	Кроха слон	Когда в игре, Кроха слон считается также Радужным существом. (В дополнении к Равнинному существу.)	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/524d05a1-6fb5-194d-ec31-9f041a4ce29d.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	blue	f	\N	CP6	Fiona	\N
53cb2d21-cbce-4e09-83da-14ff862891dd	29	Болотное партнерство	В начале твоего партнерского хода, проиграйте заключение или строение существа противника на этой линии, и тот существо теряет 2 урона.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/53cb2d21-cbce-4e09-83da-14ff862891dd.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
5426d1e1-dde5-4842-8959-5753a47ffe73	250	Переливание крови	Удали из игры карту из любой стопки сброса игроков. Восстанови X урона с выбранного существа, где X стоимость карты изъятой этим способом.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5426d1e1-dde5-4842-8959-5753a47ffe73.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
546d7f4c-8ab9-4113-9f2c-be73f81b1f99	160	Ледяная база	Когда Ледяная база вступает в игру, заморозь обе земли на этой линии. Можешь играть существо на эту землю даже если она заморожена.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/546d7f4c-8ab9-4113-9f2c-be73f81b1f99.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
54adf4a3-f1c0-4d03-9d11-cdbecc1e971b	359	Усталый воин	Усталый воин вступает в игру неактивным и не подготовлен в начале твоего хода. Всякий раз, когда он меняет линию, подготовь его.	creature	2	5	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/54adf4a3-f1c0-4d03-9d11-cdbecc1e971b.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:08.749969+00	any	t	\N	\N	\N	\N
55126f85-0d07-4b88-9e34-fab9877e512c	81	Загробный дом	Когда враг сбрасывает карту, твоё существо на этой линии получает +1 ATK до конца следующего хода.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/55126f85-0d07-4b88-9e34-fab9877e512c.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
55221c16-bdb8-4fc8-9f70-6e40a5e9c362	176	Лобстер-спасатель	Каждый раз когда существо вступает в игру во время твоего хода, ты должен восстановить 1 урон с другого существа.	creature	2	2	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/55221c16-bdb8-4fc8-9f70-6e40a5e9c362.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	sand	f	\N	\N	\N	\N
7601edb2-69d1-df7f-6467-2654ac3ba0a8	374	Хэнкклоп	\N	creature	1	3	3	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/7601edb2-69d1-df7f-6467-2654ac3ba0a8.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	any	t	\N	CP6	Cake	\N
556ae9ba-3cd6-423c-b62b-13bd82cb105b	183	Мавзолей	Твоё существо на этой линии получает +1 DEF за каждые 5 карт в твоей стопке сброса.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/556ae9ba-3cd6-423c-b62b-13bd82cb105b.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	swamp	f	\N	\N	\N	\N
55bfe759-5ab3-4df2-ab4f-d7b4791b03a0	322	Снежная полоса препятствий	ПРИЕМ >>> Заморозь обе земли на этой линии. Используй только если нет Ледяных жетонов в игре.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/55bfe759-5ab3-4df2-ab4f-d7b4791b03a0.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	any	t	\N	\N	\N	\N
5645073d-ce0d-40ce-91bc-5ed051a48f4f	224	Нога дракона	Сбрось карту >>> Нога дракона получает +1 ATK в этом ходу. (Используй до 5 раз во время своего каждого хода.)	creature	1	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5645073d-ce0d-40ce-91bc-5ed051a48f4f.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	swamp	f	\N	\N	\N	\N
56947d0e-aed8-7957-bc8a-35cd89777ada	38	Букет мечей	Нанеси 1 урон выбранному существу за каждую вытянутую тобой карту в этом ходу.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/56947d0e-aed8-7957-bc8a-35cd89777ada.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	any	t	\N	CP6	Fiona	\N
56b9734d-1fd9-479f-8083-29d75fa32055	274	Поварищество	Каждый раз раз когда коэ-нибудь из существов вашей команды проиграет 1 урон, коснеться этого нанесения урона Компание.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/56b9734d-1fd9-479f-8083-29d75fa32055.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	ice	f	\N	\N	\N	\N
57a5b82e-8ece-4d63-8771-96ddd6f002ad	330	Спасайся кто может!	Возьми выбранное существо под твоим контролем в руку затем сыграй его бесплатно.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/57a5b82e-8ece-4d63-8771-96ddd6f002ad.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	sand	f	\N	\N	\N	\N
5811ce91-38c7-4567-a434-8514bacfa601	49	Воронка	Сбрось карту, ПРИЕМ >>> Переверни выбранную землю на этой линии лицом вниз до начала твоего следующего хода.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5811ce91-38c7-4567-a434-8514bacfa601.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	corn	f	\N	\N	\N	\N
5b9db681-bf83-402b-84e3-8a162686fef3	325	Снежный кролик	Уничтожь Снежного Кролика >>> Заморозь выбранную землю.	creature	1	3	3	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5b9db681-bf83-402b-84e3-8a162686fef3.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	ice	f	\N	\N	\N	\N
5c546e85-3670-f1e9-6297-16cf232524b6	98	Зернотавр	Когда Зернотавр вступает в игру, он наносит 1 урон противнику за каждое Кукурузное поле под твоим контролем.	creature	2	2	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5c546e85-3670-f1e9-6297-16cf232524b6.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	corn	f	\N	CP1	Jake	\N
5ee124ac-e24b-43e1-8127-aad55140cefe	232	Ожерелье черных дыр	Выбранное существо получает X ATK в этом ход, где X это число различных типов земель под контролем твоего противника.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5ee124ac-e24b-43e1-8127-aad55140cefe.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
5f24662c-4f35-43e4-893b-b0e107c459dc	58	Гнилой фонтан	Сбрось карту >>> Твоё Существо на этой линии получает +1 ATK в этом ход. (Используй любое количество раз во время своего хода.)	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5f24662c-4f35-43e4-893b-b0e107c459dc.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
5f55ea55-153a-4c7e-ad93-d5c00132fe34	86	Замораживающий луч	Заморозь выбранную землю, затем тяни карту.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5f55ea55-153a-4c7e-ad93-d5c00132fe34.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	ice	f	\N	\N	\N	\N
5f65e291-035d-485d-9415-dde0c9fefdc4	106	Капитан мороженка	Капитан мороженка стоит на 1 меньше за каждое царство с Ледяным жетоном.	creature	4	4	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5f65e291-035d-485d-9415-dde0c9fefdc4.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	ice	f	\N	\N	\N	\N
5fa3df14-d0c8-8ec1-976b-b827b260de4a	369	Хитрый хорёк	ПРИЕМ >>> Тяни карту, затем сбрось карту. Если ты сбросил радужную карту таким способом, получи 1 действие.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/5fa3df14-d0c8-8ec1-976b-b827b260de4a.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	CP6	Fiona	\N
60f6209b-6dcd-df3a-e2dc-8a6a32364c3d	296	Разбойная тыква	ПРИЕМ >>> Наносим 1 урон выбранному существу. Победи это существо за каждое Кукурузное поле под твоим контролем. (Может победить каждое существо только 1 раз.)	creature	1	0	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/60f6209b-6dcd-df3a-e2dc-8a6a32364c3d.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	corn	f	\N	CP1	Jake	\N
6112ef7f-50a8-47a6-975f-63ed606e8473	209	Мушка-хлопушка	ПРИЕМ >>> Каждый противник сбрасывает карту стоимостью 0 или показывает руку, если их нет.	creature	1	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6112ef7f-50a8-47a6-975f-63ed606e8473.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	swamp	f	\N	\N	\N	\N
611bfcbc-eb9a-4d8c-9c22-788ccdb918c9	96	Зеленая сахарная вата	Восстанови или нанеси 1 Урон выбранному существу.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/611bfcbc-eb9a-4d8c-9c22-788ccdb918c9.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	any	t	\N	\N	\N	\N
611c77a9-de38-55dc-0da6-9639c0250dd3	150	Кукурузный пес	Кукурузный пес получает +1 DEF за каждое Кукурузное поле под твоим контролем. Если их 3 или меньше, то также +1 ATK.	creature	1	0	12	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/611c77a9-de38-55dc-0da6-9639c0250dd3.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	CP1	Jake	\N
617d9d34-1570-4ccc-e3dd-2f955b38b6fa	144	Кукурузное бревно	Твоё существо на этой линии получает +2 ATK.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/617d9d34-1570-4ccc-e3dd-2f955b38b6fa.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	CP1	Jake	\N
626a4f12-9991-4da8-8a5d-fa76d44cc502	121	Космонапереток	Потеряй 2 здоровья, получи 1 действие.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/626a4f12-9991-4da8-8a5d-fa76d44cc502.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	any	t	\N	\N	\N	\N
626c5745-d091-45cd-a8ed-b68c0cab5ce7	385	Шалаш Вайда	ПРИЕМ >>> Перемести существо на соседнюю линию (если она пустая).	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/626c5745-d091-45cd-a8ed-b68c0cab5ce7.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	\N	\N	\N
62a799f9-2f09-c225-c938-53ce2dc7cfc5	151	Кукурузный ронни	Кукурузный ронни получает +1 ATK за каждое соседнее Кукурузное поле.	creature	1	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/62a799f9-2f09-c225-c938-53ce2dc7cfc5.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	CP1	Jake	\N
642df00f-ac17-4c04-9ab5-539895f0c053	237	Острый парень	ПРИЕМ >>> Нанеси 2 урона выбранному существу противника на этой линии.	creature	1	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/642df00f-ac17-4c04-9ab5-539895f0c053.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	corn	f	\N	\N	\N	\N
643302f9-f208-4706-a466-dc441838013c	314	Ска-пион	Пока противник контролирует твоё существо, Ска-пион стоит на 1 меньше, чтобы сыграть его.	creature	1	3	3	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/643302f9-f208-4706-a466-dc441838013c.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	sand	f	\N	\N	\N	\N
64712999-d918-43bf-ac3a-edd7722e4341	56	Геркулаз	Сбрось карту >>> Геркулаз получает +4 ATK в этом ход. (Используй только один раз в каждый свой ход.)	creature	2	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/64712999-d918-43bf-ac3a-edd7722e4341.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
65307864-1cdf-4559-b8a2-b40bc44d1b58	84	Замеряный голем	Замеряный голем стоит на 1 меньше за каждое другое существо сыгранное в этом ходу.	creature	3	5	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/65307864-1cdf-4559-b8a2-b40bc44d1b58.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	sand	f	\N	\N	\N	\N
65d39ecd-061e-4d69-9f04-3e762b4f1931	268	Пиромансер	Каждый раз, когда Пиромансер помещается на землю, нанеси 3 урона выбранному существу в этой линии. Потрать 1 действие >>> Перемести Пиромансера на пустую землю под твоим контролем.	creature	1	0	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/65d39ecd-061e-4d69-9f04-3e762b4f1931.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	blue	f	\N	\N	\N	\N
660325d8-04dd-4291-8e71-326cb2e5ac09	345	Торжество чар	Выбери существо и перемести его на соседнюю землю под контролем его владельца. Как сделал это, можешь отдать карту партнеру в руку.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/660325d8-04dd-4291-8e71-326cb2e5ac09.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	any	t	\N	\N	\N	\N
660470c8-190b-4a91-aef5-e68161f3abeb	269	Плавучий Дворец Льда	Твоё существо на этой земле получает +1 ATK во время твоего хода за каждую землю с ледяным жетоном.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/660470c8-190b-4a91-aef5-e68161f3abeb.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	ice	f	\N	\N	\N	\N
683d5639-5fb2-4262-a433-2d690921ec5b	105	Камнекраб результировщик	Каждый раз когда Камнекраб результировщик получает урон от существа, можешь переместить это существо на пустую соседнюю линию.	creature	2	2	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/683d5639-5fb2-4262-a433-2d690921ec5b.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	sand	f	\N	\N	\N	\N
68743bc3-b732-411f-bf31-1f4df08ab9d8	297	Раздуха партнерства	Когда раскрытое заклинание партнерства или партнерское строение становится в игру, сбрось карту и выбери, затем как действие каждый партнер сможет играть бесплатно.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/68743bc3-b732-411f-bf31-1f4df08ab9d8.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	any	t	\N	\N	\N	\N
694c2fd5-0cfa-4a0d-a4a0-73a213345a2b	167	Ледяной гонщик	+4 ATK, если обе земли на этой линии имеют Ледяные жетоны.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/694c2fd5-0cfa-4a0d-a4a0-73a213345a2b.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
6962e552-e9ef-1030-7569-8d389fa5da7f	158	Легион уховёрток	Когда Легион уховёрток вступает в игру, можешь вернуть выбранное существо на этой линии его владельцу.	creature	2	2	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6962e552-e9ef-1030-7569-8d389fa5da7f.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:05.12985+00	corn	f	\N	CP1	Jake	\N
69fd5f11-7ca5-17b4-4938-cab72a2288fa	328	Солнц гнома	Тяни 3 карты.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/69fd5f11-7ca5-17b4-4938-cab72a2288fa.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	any	t	\N	CP1	Jake	\N
6a6a67e7-0e41-4501-bb80-ecf887c8ca9e	103	Императорский пингвин	Существа на землях с ледяным жетоном получают -1 ATK.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6a6a67e7-0e41-4501-bb80-ecf887c8ca9e.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	ice	f	\N	\N	\N	\N
6af6e04f-5a4f-486c-bc0f-35f4aec96a1a	361	Ферма	Ферма считается за дополнительную Кукурузную землю под твоим контролем.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6af6e04f-5a4f-486c-bc0f-35f4aec96a1a.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	corn	f	\N	\N	\N	\N
6b02e3b0-9160-4fca-8eb9-8e763a370d80	338	Сшитая белка	Если в начале твоего хода у Сшитой белки 4 урона и более, у нее выбранное строение противника на этой линии.	creature	1	2	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6b02e3b0-9160-4fca-8eb9-8e763a370d80.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	good	f	\N	\N	\N	\N
6b358d08-ac3a-4675-ae72-d60d6238f457	172	Ледяной лазумчик	Когда Ледяной лазумчик вступает в игру, заморозь его землю.	creature	0	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6b358d08-ac3a-4675-ae72-d60d6238f457.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	\N	\N	\N
6b74f280-3bdb-4ca2-8747-f67be5e9e605	164	Ледяное пение	Выбери и заморозь 1 землю у каждого игрока, затем тяни карту.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6b74f280-3bdb-4ca2-8747-f67be5e9e605.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
6beb29f5-48cb-4a9d-93a6-314154d23e52	329	Сотрудничество	В первый раз когда ты или твой партнёр сыграете Радужное заклинание, во время этого же хода, другой партнёр может сыграть Радужное заклинание той же стоимости бесплатно.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6beb29f5-48cb-4a9d-93a6-314154d23e52.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	any	t	\N	\N	\N	\N
6c4de6a4-0e0d-4a58-96ef-d9ae0ae0ff2f	10	Дуэт	Восстанови 1 урон у Существа под твоим контролем и 1 урон у существа не под твоим контролем	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6c4de6a4-0e0d-4a58-96ef-d9ae0ae0ff2f.png	2026-08-11 13:56:54.669194+00	2026-08-16 18:43:41.183414+00	any	t	\N	\N	\N	\N
6df0c398-c516-42c0-8ec8-44b80b6a7e13	27	Биомансер	Каждый раз когда существо под твоим контролем меняет линию, восстанови 2 урона Биомансеру.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6df0c398-c516-42c0-8ec8-44b80b6a7e13.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	blue	f	\N	\N	\N	\N
6e897788-cfb4-4c3c-a812-fa0a4848f0b3	166	Ледяной банк	ПРИЕМ, Сними Ледяной жетон с земли на этой линии >>> Нанеси 3 урона выбранному противнику.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6e897788-cfb4-4c3c-a812-fa0a4848f0b3.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
6ea959ef-c4cb-4b3d-91d0-aac96ed8b5fc	191	Мельница процветания	Пока на твоём существе на этой линии нет урона, оно получает +2 ATK.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/6ea959ef-c4cb-4b3d-91d0-aac96ed8b5fc.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	good	f	\N	\N	\N	\N
70f86e19-e0e8-40b5-999e-c9a4ebee91ce	396	Яростный петух	Яростный петух получает +1 ATK за каждую единицу урона на нем.	creature	1	0	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/70f86e19-e0e8-40b5-999e-c9a4ebee91ce.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	good	f	\N	\N	\N	\N
71ebca0e-8f0f-c296-da3c-5cd23b006b24	192	Меч певунец	Выбранное существо получает +1 ATK за каждые 2 вытянутые тобой карты в этом ходу.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/71ebca0e-8f0f-c296-da3c-5cd23b006b24.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	CP6	Fiona	\N
7228ef3b-1118-4eca-9ed7-3c6c7f526fb1	14	Банан в шоколаде	Если в начале твоей фазы сражения, на этой линии есть хотя бы один Ледяной жетон, нанеси 2 урона выбранному противнику.	creature	1	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/7228ef3b-1118-4eca-9ed7-3c6c7f526fb1.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	ice	f	\N	\N	\N	\N
72629189-6151-4952-b000-1cf2ca531f38	337	Струзен Джинн	+2 ATK каждому Примененному существу под твоим контролем.	creature	2	1	11	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/72629189-6151-4952-b000-1cf2ca531f38.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:48:52.253741+00	blue	f	\N	\N	\N	\N
728cc8a6-1a2f-4f90-9932-8aefbff75847	31	Большой дух воина	Каждое соседнее существо получает +1 ATK.	creature	1	1	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/728cc8a6-1a2f-4f90-9932-8aefbff75847.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	blue	f	\N	\N	\N	\N
737bb0ac-ebac-49d1-aa56-cec823f30425	8	Ангельское сердце	Пока на Ангельском сердце ровно 3 урона, оно получает +3 ATK.	creature	0	0	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/737bb0ac-ebac-49d1-aa56-cec823f30425.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
73b39f6f-1a38-4649-b1df-b15c6f12594f	257	Песочный краб рубака	Каждый раз когда во время твоего хода существо вступает в игру на соседнюю линию, Песочный краб рубака наносит 2 урона существу на этой линии.	creature	2	2	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/73b39f6f-1a38-4649-b1df-b15c6f12594f.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
744cc7ff-d56b-1239-f238-6a3efdff08d1	146	Кукурузные рыцари	Кукурузные рыцари получают +1 ATK и +2 DEF за каждое Кукурузное поле под твоим контролем лицом вниз.	creature	1	0	11	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/744cc7ff-d56b-1239-f238-6a3efdff08d1.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	CP1	Jake	\N
74618acc-175b-4caf-95b7-b36689ea76f3	22	Бесконечный комбайн	Выбери существо и нанеси себе урон равный осматку DEF, затем уничтожь существо.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/74618acc-175b-4caf-95b7-b36689ea76f3.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	corn	f	\N	\N	\N	\N
746e3527-35db-4ea6-8c26-7358fb8b9ecb	17	Башня свободы	Сбрось карту >>> Твоя земля на этой линии теряет свой тип земли и берет тип по твоему выбору (кроме перевернутых) до начала твоего следующего хода.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/746e3527-35db-4ea6-8c26-7358fb8b9ecb.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	corn	f	\N	\N	\N	\N
74c1ce31-9fda-4df9-8706-c4ca7a13742c	75	Дрожь земли	+2 ATK за каждую землю в игре, перевернутую лицом вниз.	creature	1	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/74c1ce31-9fda-4df9-8706-c4ca7a13742c.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	corn	f	\N	\N	\N	\N
75daba8e-8e91-48e6-8f29-1efb6623d34d	227	Обнимашки	Уничтожь выбранное существо под твоим контролем, затем уничтожь выбранное существо противника на этой линии.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/75daba8e-8e91-48e6-8f29-1efb6623d34d.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	good	f	\N	\N	\N	\N
7636519c-863c-43e5-8a30-e46cb0a4201c	28	Болотная бомба-лягушка	Если Болотная бомба-лягушка покидает игру пока подготовлен, нанеси 2 урона каждому существу противника.	creature	2	3	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/7636519c-863c-43e5-8a30-e46cb0a4201c.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	swamp	f	\N	\N	\N	\N
766142e4-df6c-490d-9720-388aec49be9c	387	Шипастый зебрагон	Когда Шипастый зебрагон атакует, нанеси 1 урон каждому существу на соседней линии.	creature	2	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/766142e4-df6c-490d-9720-388aec49be9c.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	corn	f	\N	\N	\N	\N
7698b207-bc0a-428a-97d8-25324581e209	317	Слинять	Когда выбранное существо атакует в этом ход, оно покидает игру перед разовой сражением, сними весь урон с него за это.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/7698b207-bc0a-428a-97d8-25324581e209.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	corn	f	\N	\N	\N	\N
782b1508-c30f-4b63-b4b5-aca878c94ec5	266	Пирогоморф	Каждое твоё существо без урона на нем получает +2 ATK в этом ход.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/782b1508-c30f-4b63-b4b5-aca878c94ec5.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	good	f	\N	\N	\N	\N
790e8a03-c9e1-7c54-1205-8c55f248db59	395	Яростный гнев	Выбранное существо получает +2 ATK в этом ходу за каждое примененное существо под твоим контролем.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/790e8a03-c9e1-7c54-1205-8c55f248db59.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	corn	f	\N	CP6	Cake	\N
7a3849ec-3514-411c-b3ea-8290b6297880	133	Крок-зачинщик	Когда Крок-зачинщик вступает в игру, передвинь выбранное существо противника на линию Крок-зачинщика (если она пуста).	creature	2	5	3	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/7a3849ec-3514-411c-b3ea-8290b6297880.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	swamp	f	\N	\N	\N	\N
7bd1dbe1-1036-4e6d-ba52-56e6f1f65842	360	Утка-менестрель	ПРИЕМ >>> Тяни карту. Если у Утки-менестреля 5 или более урона, то тяни еще одну.	creature	1	0	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/7bd1dbe1-1036-4e6d-ba52-56e6f1f65842.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:08.749969+00	good	f	\N	\N	\N	\N
7dbcb8ec-dbb0-498b-b6ea-16cfec3e8f61	16	Башня правды	Потрать 2 действия >>> Укради случайную карту с руки противника и сыграй ее бесплатно.	building	1	0	0	f	\N	[]		2026-08-11 13:56:54.669194+00	2026-08-16 18:38:48.734065+00	any	t	\N	\N	\N	\N
7dc19f6b-a2a0-d69a-5411-f1fd2768d953	76	Друг почamка	Применённое существо под твоим контролем получает +1 ATK.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/7dc19f6b-a2a0-d69a-5411-f1fd2768d953.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	corn	f	\N	CP6	Cake	\N
7e469d11-e743-4f4d-a468-82c8268766db	134	Крок-исследователь	Сбрось карту >>> Крок-исследователь получает +ATK равную стоимости сброшенной карты (используй только во время своего хода).	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/7e469d11-e743-4f4d-a468-82c8268766db.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	swamp	f	\N	\N	\N	\N
7e52d9a4-1c3b-3f1b-5dc8-7169fb82b7ab	223	Нефтяная Вышка	Твоё существо на этой земле получает +2 DEF за каждую Нефтяную вышку под твоим контролем.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/7e52d9a4-1c3b-3f1b-5dc8-7169fb82b7ab.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	blue	f	\N	CP6,CP1	Finn	\N
7ff90b5a-58b4-4983-8e65-dbf8f95d99b3	147	Кукурузный гарнизон	Твоё существо на этой земле получает +1 ATK и +1 DEF за каждое Кукурузное существо под твоим контролем.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/7ff90b5a-58b4-4983-8e65-dbf8f95d99b3.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	\N	\N	\N
8058eb47-e5b6-4c8a-bb62-bc5b3ca5e027	142	Крышесносная кола	Каждое существо в игре получает +1 ATK в этом ходу (включая существ противника).	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8058eb47-e5b6-4c8a-bb62-bc5b3ca5e027.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	any	t	\N	\N	\N	\N
80a3b161-1d64-4b2e-be87-ae6656013d51	97	Зеленый тритон	ПРИЕМ >>> Положи верхнюю карту из своей колоды в стопку сброса. Нанеси урон каждому существу равный стоимости действий карты.	creature	2	0	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/80a3b161-1d64-4b2e-be87-ae6656013d51.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
815dbea2-cc55-4dd2-9848-eb09e2765934	34	Бордер колли	ПРИЕМ >>> Перемести Бордер колли на любую свою пустую землю. Если эта земля заморожена, получи 1 Действие.	creature	1	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/815dbea2-cc55-4dd2-9848-eb09e2765934.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	ice	f	\N	\N	\N	\N
8211dffc-b9d3-430e-8d99-eb6816401511	243	Очаровательный кролик	Если в начале твоего хода у Очаровательного кролика 4 урона и более, нанеси 3 урона выбранному противнику.	creature	0	0	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8211dffc-b9d3-430e-8d99-eb6816401511.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
8227c90f-5504-4f7b-a7ab-56397a0cf5e1	373	Хрономансер	Каждый раз когда Хрономансер меняет линию, получи 1 действие.	creature	2	3	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8227c90f-5504-4f7b-a7ab-56397a0cf5e1.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	\N	\N	\N
843a00d1-1e31-4c0b-9839-00b283fd2216	119	Королевский малыш	Потрать 1 Действие, ПРИЕМ >>> Нанеси 1 урон выбранному существу за каждую Кукурузную землю под твоим контролем.	creature	2	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/843a00d1-1e31-4c0b-9839-00b283fd2216.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	corn	f	\N	\N	\N	\N
edb2995b-d2aa-4ae1-93f3-842eeee455ac	71	Дорога снега	Заморозь две выбранные земли.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/edb2995b-d2aa-4ae1-93f3-842eeee455ac.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	ice	f	\N	\N	\N	\N
8488324a-06b3-ab47-5c48-bba808d20427	362	Фермер-кочевник	Когда Фермер-кочевник покидает игру, нанеси 1 урон противнику за каждую карту в его руке.	creature	2	2	12	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8488324a-06b3-ab47-5c48-bba808d20427.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	corn	f	\N	CP1	Jake	\N
85ffaf46-d495-04bd-3b9b-fa41a911e462	65	Деревянный ритм	Каждое твоё существо на земле со строением получает +2 ATK в этом ходу.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/85ffaf46-d495-04bd-3b9b-fa41a911e462.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	corn	f	\N	CP6	Cake	\N
86a9ebb9-4d7d-491d-85a9-ad19f102a951	310	Серф-лобстер	+1 ATK за каждую землю Бесполезных болот в игре.	creature	2	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/86a9ebb9-4d7d-491d-85a9-ad19f102a951.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	sand	f	\N	\N	\N	\N
86be6c15-52ed-4867-92bc-0abc6219ec87	307	Свободное падение	Каждое твоё существо получает +1 ATK в этом ходу за каждое существо введённое в игру в этом ход.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/86be6c15-52ed-4867-92bc-0abc6219ec87.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	sand	f	\N	\N	\N	\N
86eb2dd2-b3d9-472b-a4b6-9a52a2807468	301	Рок-н-рольщик	Когда Рок-н-рольщик вступает в игру, переверни землю на этой линии лицом вниз. Когда он покидает игру, переверни её лицом вверх.	creature	2	2	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/86eb2dd2-b3d9-472b-a4b6-9a52a2807468.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	corn	f	\N	\N	\N	\N
871f19a8-6b4c-4db5-85c2-dba7d319f5d8	386	Шаровая бобовая бомба	ПРИЕМ >>> Восстанови или нанеси урон своему существу на этой земле, если у него 4 урона.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/871f19a8-6b4c-4db5-85c2-dba7d319f5d8.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	good	f	\N	\N	\N	\N
8722f9d6-8f1b-44ad-98a2-bf9638ed25c3	275	Подделка	ПРИЕМ >>> Перенеси Ледяной жетон с одной земли на другую землю.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8722f9d6-8f1b-44ad-98a2-bf9638ed25c3.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	any	t	\N	\N	\N	\N
87d393d3-3269-4b47-ab9c-b3a0df46bba2	196	Милый Оверлорд	Уничтожь любое число существ под твоим контролем. Тяни карту за каждое существо уничтоженного таким образом.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/87d393d3-3269-4b47-ab9c-b3a0df46bba2.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	\N	\N	\N
87e67325-37c0-4a58-86bd-16d3a47847bd	171	Ледяной зал	Заморозь выбранную землю. Ты можешь перемешать любое количество ледяных жетонов на земле на новые земли (1 жетон на землю).	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/87e67325-37c0-4a58-86bd-16d3a47847bd.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
89b8def4-506f-4aab-b045-4ac70dfa6138	39	Бумажный тигр	Пока на Бумажном тигре ровно 5 урона, он получает +5 ATK.	creature	2	2	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/89b8def4-506f-4aab-b045-4ac70dfa6138.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	good	f	\N	\N	\N	\N
89c28960-52c7-9002-5ca5-5ea59c6c3cdf	91	Заумный Шторм Крови	Наносим 1 Урон каждому существу противника.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/89c28960-52c7-9002-5ca5-5ea59c6c3cdf.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	any	t	\N	CP1	Jake	\N
8a2cc3af-1080-415b-8115-4d6abbe5a4aa	202	Молодой крылатый зебрагон	Если Молодой крылатый зебрагон покидает игру во время твоей фазы сражения, можешь положить его на верх своей колоды.	creature	1	2	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8a2cc3af-1080-415b-8115-4d6abbe5a4aa.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:05.12985+00	corn	f	\N	\N	\N	\N
8a2ee4cd-8437-37bc-9f20-ccf9388b6fbc	367	Хипец	Когда Хипец вступает в игру, можешь вернуть выбранное существо на этой линии его владельцу.	creature	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8a2ee4cd-8437-37bc-9f20-ccf9388b6fbc.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	corn	f	\N	CP1	Jake	\N
8a8ce05e-f7e9-f046-32aa-db4fddc587db	220	Нежный Снежный Малыш	+3 ATK пока у противника нет существа на этой линии.	creature	0	1	2	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8a8ce05e-f7e9-f046-32aa-db4fddc587db.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	any	t	\N	CP1	Finn	\N
8ad2f612-8b70-15c9-2b56-f4484fd0a1b1	85	Замок Крови	Каждый раз когда существо противника на этой линии получает урон, прибавь к значению 1.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8ad2f612-8b70-15c9-2b56-f4484fd0a1b1.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	any	t	\N	CP6	Cake	\N
8c1be572-1fee-4bf1-8a3d-205a8c5b05a6	99	Зимний солдат	+3 ATK пока твой противник не контролирует существо на этой линии.	creature	1	2	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8c1be572-1fee-4bf1-8a3d-205a8c5b05a6.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	ice	f	\N	\N	\N	\N
8cf94545-56da-4e84-aa87-8f212dab95b0	375	Царица полей	Царица полей получает +1 ATK за каждое применённое существо под твоим контролем.	creature	1	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8cf94545-56da-4e84-aa87-8f212dab95b0.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	corn	f	\N	\N	\N	\N
8cfd0bbc-fa3c-72eb-837c-f08faf21faae	143	Кукурузная валькирия	Кукурузная валькирия получает +2 ATK и +2 DEF, если на этой земле строение под твоим контролем.	creature	2	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8cfd0bbc-fa3c-72eb-837c-f08faf21faae.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	CP6	Cake	\N
8d093f6d-0ae9-43a5-83c7-8977abb052c5	332	Стена песка	Если другое песчаное существо, одно или более, вступает в игру во время твоего хода, Песчаная стена получает +2 ATK в этом ходу.	spell	2	1	12	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8d093f6d-0ae9-43a5-83c7-8977abb052c5.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	sand	f	\N	\N	\N	\N
8d4b7911-4202-4c91-9f16-9d0e3c20536e	67	Док Куколштейн	ПРИЕМ >>> Восстанови 2 урона с существа на соседней линии. Если на Доке Куколштейне 5 или более урона, то вместо этого восстанови 2 урона с каждого существа.	creature	2	1	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8d4b7911-4202-4c91-9f16-9d0e3c20536e.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	good	f	\N	\N	\N	\N
8d5dd2e5-2a74-4794-b63b-9bcc4a59b940	244	Падающая звезда	Существа под твоим контролем не получают урон от существ противника в этом ходу.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8d5dd2e5-2a74-4794-b63b-9bcc4a59b940.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	good	f	\N	\N	\N	\N
8d77f0a7-515d-4d69-9870-e1ae3c17337d	77	Дьявольский глазстик	ПРИЕМ >>> Верни карту стоимостью 0 из своей стопки сброса себе в руку.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8d77f0a7-515d-4d69-9870-e1ae3c17337d.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
8da809af-54dd-4191-ac24-3ffc4d3cbc14	69	Домашний кактус	+2 ATK за каждый Домашний кактус под твоим контролем.	creature	1	0	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8da809af-54dd-4191-ac24-3ffc4d3cbc14.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	sand	f	\N	\N	\N	\N
8ea494a7-0bdf-4686-8464-948f263eaab5	131	Крок-дезинсектор	Потрать 1 Действие, ПРИЕМ >>> Нанеси 1 урон каждому существу противника в игре.	creature	1	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8ea494a7-0bdf-4686-8464-948f263eaab5.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	swamp	f	\N	\N	\N	\N
8f2b5cf5-b2f8-40e4-a6bb-0ea839ee07c9	60	Горячая подача	Уничтожь выбранное существо противника. Каждый противник тянет столько карт сколько стоило это существо.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/8f2b5cf5-b2f8-40e4-a6bb-0ea839ee07c9.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	sand	f	\N	\N	\N	\N
90cbf716-9b68-444a-9b72-e698e80689da	186	Майонезный ангел	Потрать 1 Действие >>> Восстанови весь урон с Майонезного ангела.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/90cbf716-9b68-444a-9b72-e698e80689da.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	good	f	\N	\N	\N	\N
9107def3-4ea9-4e74-bf64-27d5fc72c2cf	108	Картонный особняк	Картонный особняк стоит на 1 меньше за каждые 5 карт в твоей стопке сброса. ПРИЕМ >>> Получи 1 Действие.	building	5	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9107def3-4ea9-4e74-bf64-27d5fc72c2cf.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	swamp	f	\N	\N	\N	\N
916c9cc8-7311-4dfc-9f7e-c0c76ce9f477	112	Коктейль	ПРИЕМ >>> Перенеси Ледяной жетон с одной земли на другую землю.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/916c9cc8-7311-4dfc-9f7e-c0c76ce9f477.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	ice	f	\N	\N	\N	\N
91a6434b-c439-4d59-b384-7691aa5b2136	239	Отталкивающий камнекраб	Каждый раз когда Камнекраб результировщик получает урон от существа, он наносит столько же урона этому существу.	creature	1	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/91a6434b-c439-4d59-b384-7691aa5b2136.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	sand	f	\N	\N	\N	\N
9380efb6-542a-4399-bc5e-2b5a8e8826f7	204	Мороженник	В начале своего хода нанеси 1 урон каждому существу на земле с ледяным жетоном.	creature	2	1	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9380efb6-542a-4399-bc5e-2b5a8e8826f7.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	ice	f	\N	\N	\N	\N
93bbdffb-903a-47e6-8c13-a5f8473fb19b	222	Непустой гроб	Следующее существо сыгранное тобой в этом ход стоит на 2 действия меньше.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/93bbdffb-903a-47e6-8c13-a5f8473fb19b.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
944ff964-c242-46a1-bea1-e4c212326619	162	Ледяная леди	Выбранный игрок сбрасывает 1 карту с руки за каждую землю с ледяным жетоном под его контролем.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/944ff964-c242-46a1-bea1-e4c212326619.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
948b8fd3-e7e3-4d4c-9096-70991675642f	3	Авто-ощипыватель	ПРИЕМ >>> Восстанови или нанеси 1 урон своему существу на этой линии.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/948b8fd3-e7e3-4d4c-9096-70991675642f.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	good	f	\N	\N	\N	\N
962ef500-7ff4-4835-9bd3-260fb0fbd972	354	Уни-рыцарь	Потрать 1 действие >>> Выбери существо на этой линии, оно получает -10 ATK в этом ходу.	creature	1	3	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/962ef500-7ff4-4835-9bd3-260fb0fbd972.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:08.749969+00	blue	f	\N	\N	\N	\N
96d8f3cb-4bb4-4226-a30a-a81198d38d4b	190	Мать-паук	В начале своего хода нанеси 1 урон выбранному существу за каждые 5 карт в твоей стопке сброса.	creature	1	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/96d8f3cb-4bb4-4226-a30a-a81198d38d4b.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	swamp	f	\N	\N	\N	\N
973995ae-435c-beb5-f300-547e7abc6b86	381	Червь шелухи	Когда Червь шелухи вступает в игру, переверни Кукурузное поле под твоим контролем лицом вниз.	creature	1	5	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/973995ae-435c-beb5-f300-547e7abc6b86.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	corn	f	\N	CP1	Jake	\N
97a13c55-f654-49df-a7a9-0ad57fc4be50	168	Ледяной диверсант	Ледяной диверсант получает +1 ATK за каждую землю с Ледяным жетоном.	creature	1	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/97a13c55-f654-49df-a7a9-0ad57fc4be50.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
97d36a75-45b5-d49c-539e-dceac93872ae	36	Браслет дружбы	Поменяй любое количество урона между двумя существами под твоим контролем.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/97d36a75-45b5-d49c-539e-dceac93872ae.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	any	t	\N	CP6	Fiona	\N
98052819-04fa-1fee-1828-ad08588718ea	102	Игривый ретривер	Каждый раз когда Игривый ретривер атакует, можешь тянуть карту.\r\n"Больше мячиков! Гав!"	creature	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/98052819-04fa-1fee-1828-ad08588718ea.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	blue	f	\N	CP6	Fiona	\N
99e8e9c0-6ef9-4434-f28b-7dcab8802518	12	Баба-лесоруб	Когда лесоруб вступает в игру, нанеси 1 урон противнику за каждое строение под твоим контролем.	creature	2	3	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/99e8e9c0-6ef9-4434-f28b-7dcab8802518.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	corn	f	\N	CP6	Cake	\N
9acf6ca7-1b42-492d-811e-e0e090a9156b	90	Затопление	Существа противника получают -2 ATK в этом ход (минимум 0).	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9acf6ca7-1b42-492d-811e-e0e090a9156b.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
9b558a9f-01ce-4e72-9bc6-b2c2d8e7c4d8	53	Вязаный котенок	На Вязаного котенка действуют строения соседних земель.	creature	2	3	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9b558a9f-01ce-4e72-9bc6-b2c2d8e7c4d8.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	good	f	\N	\N	\N	\N
9b8650f5-05d2-4055-acd7-253591d25cb2	2	Аванпост попугаев	Каждое существо на этой линии получает -1 ATK (минимум 0).	building	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9b8650f5-05d2-4055-acd7-253591d25cb2.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
9c07e203-5132-490d-9a28-99715f146c8b	333	Стена початков	Стена початков получает +1 DEF за каждое Кукурузное поле в игре (у всех игроков).	creature	1	2	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9c07e203-5132-490d-9a28-99715f146c8b.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	corn	f	\N	\N	\N	\N
9c6c4e76-d2ce-4800-80ef-a63e1ee79e20	64	Дворец топи	Твоё существо на этой линии получает +3 ATK. В начале твоего хода, сбрось карту.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9c6c4e76-d2ce-4800-80ef-a63e1ee79e20.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
9dd03067-9d4a-427c-b815-9c115a8ea029	215	Мятная мороженка	Пока на соседних линиях нет существ, Мятной мороженке нельзя нанести урон заклинаниями или способностями существ.	creature	1	3	3	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9dd03067-9d4a-427c-b815-9c115a8ea029.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	ice	f	\N	\N	\N	\N
9e15c468-b722-45e1-ab52-e857ff2a06b3	364	Фирменное рукопожатие	Нанеси 5 урона себе и выбранному противнику.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9e15c468-b722-45e1-ab52-e857ff2a06b3.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	any	t	\N	\N	\N	\N
9e51f995-219b-455a-97f2-2a3d11bf662a	18	Бездомный болот	Если Бездомный болот покидает игру, пока подготовлен, каждый противник сбрасывает карту.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9e51f995-219b-455a-97f2-2a3d11bf662a.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	swamp	f	\N	\N	\N	\N
9e685460-a6d3-49e3-9fe7-f7a0e4f39d5f	306	Свинья	ПРИЕМ >>> Выбери и переверни Кукурузное поле на этой линии лицом вниз.	creature	1	1	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9e685460-a6d3-49e3-9fe7-f7a0e4f39d5f.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	any	t	\N	\N	\N	\N
9f32a7db-1fd9-4773-beae-c7b8c133bacc	180	Лысый бродига	В начале каждого хода положи верхнюю карту из своей колоды в стопку сброса.	creature	0	0	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/9f32a7db-1fd9-4773-beae-c7b8c133bacc.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	\N	\N	\N
a0287a96-2d70-4208-bde7-d168c527ee0e	358	Усталый бомбат	В начале своего хода перемести Усталого бомбата на пустую землю под твоим контролем. Если не смог, то перемести на пустую землю твоего противника.	creature	2	4	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a0287a96-2d70-4208-bde7-d168c527ee0e.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:08.749969+00	any	t	\N	\N	\N	\N
a072bf5d-dc70-32bf-f7e0-479c1bfe329c	153	Кукурузный чемпион	Кукурузный чемпион получает +2 ATK и +2 DEF, если на этой земле под твоим контролем.	creature	1	1	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a072bf5d-dc70-32bf-f7e0-479c1bfe329c.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:05.12985+00	corn	f	\N	CP6	Cake	\N
a0f27839-45f4-4ad5-946a-e945eb2ed5ec	355	Унитаз апокалипсиса	Выбранное существо под твоим контролем получает +1 ATK в этом ходу за каждые 5 карт в твоей стопке сброса.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a0f27839-45f4-4ad5-946a-e945eb2ed5ec.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:08.749969+00	swamp	f	\N	\N	\N	\N
a1728344-ed7b-4575-bc31-9ddf4bee7778	351	Тёмный маяк	ПРИЕМ >>> Если у противника нет существа на этой линии, то он сбрасывает карту.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a1728344-ed7b-4575-bc31-9ddf4bee7778.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	swamp	f	\N	\N	\N	\N
a195e43f-cf00-46cc-b1a9-387940a82ae5	348	Тупица в наушниках	Когда Тупица в наушниках вступает в игру замени существо, нанеси 3 урона другому существу на этой линии.	creature	2	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a195e43f-cf00-46cc-b1a9-387940a82ae5.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	blue	f	\N	\N	\N	\N
a2eac635-5748-3650-f2e3-bc108c8198f3	110	Коготь дракона	ПРИЕМ >>> Отправь существо под твоим контролем на пустую линию.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a2eac635-5748-3650-f2e3-bc108c8198f3.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	blue	f	\N	CP1	Finn	\N
a5d7756c-ef3c-8237-dbf6-b96d7aaf6ebf	366	Ханна	Когда Ханна наносит урон существу противника, она восстанавливает 1 HP.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a5d7756c-ef3c-8237-dbf6-b96d7aaf6ebf.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	CP1	Finn	\N
a688bda0-a3af-46d0-82c4-89b02b3ccf42	236	Остролист	Если в твоей стопке сброса 10 карт или более, потрать на 2 действия меньше чтобы сыграть Остролиста.	creature	2	3	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a688bda0-a3af-46d0-82c4-89b02b3ccf42.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	swamp	f	\N	\N	\N	\N
a6bfcaeb-5178-d4a1-43c4-4db5d8165f1e	125	Крепкий лесоруб	Можешь сыграть дополнительное строение на этой земле.	creature	2	2	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a6bfcaeb-5178-d4a1-43c4-4db5d8165f1e.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	CP6	Cake	\N
a7ddb739-d528-4430-a6f6-85ecbd6fd7be	205	Морозильная камера	Существа на землях с ледяными жетонами на этой линии, не могут атаковать или использовать способности.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a7ddb739-d528-4430-a6f6-85ecbd6fd7be.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	ice	f	\N	\N	\N	\N
a8ddbfe3-a721-42c1-b26e-b762c76d9978	50	Восстановление ландшафта	Можешь перевернуть одну свою землю лицом вверх. Можешь переместить одно своё строение на свою линию без строений.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a8ddbfe3-a721-42c1-b26e-b762c76d9978.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
a93c7b37-9296-8538-2f2a-8da870125d12	141	Крысолов	Когда Крысолов атакует существо противника, можешь атаковать применённым существом под твоим контролем вместо него.	creature	2	1	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/a93c7b37-9296-8538-2f2a-8da870125d12.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	CP6	Cake	\N
ac0b95eb-04f0-4d48-b2a8-48ab18e9c90f	82	Закусочная	ПРИЕМ >>> Тяни карту за каждое существо введённое в игру на эту землю в этом ход.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ac0b95eb-04f0-4d48-b2a8-48ab18e9c90f.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	sand	f	\N	\N	\N	\N
ac40138d-3827-4e24-b84d-2fbcb1412c08	270	Пламенная мышь	Играй Пламенную мышь только если у тебя 10 или более карт в стопке сброса.	creature	1	4	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ac40138d-3827-4e24-b84d-2fbcb1412c08.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	swamp	f	\N	\N	\N	\N
ac940e2b-1aec-40c6-9e52-a4f968e7b465	208	Муми-тролль	ПРИЕМ >>> Получи 1 Действие в этом ходу.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ac940e2b-1aec-40c6-9e52-a4f968e7b465.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	sand	f	\N	\N	\N	\N
ad746d92-5c4f-77c1-1cd2-dcede2d880f4	246	Парад щенков	Восстанови 2 урона с каждого существа под твоим контролем. Существа под твоим контролем теряют свой тип земли и становятся Радужными на этот ход.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ad746d92-5c4f-77c1-1cd2-dcede2d880f4.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	blue	f	\N	CP6	Fiona	\N
ad944788-4a61-13f4-42ad-5c7da6951d35	45	Великолепная Крепость	Существо противника на этой линии получает -2 DEF.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ad944788-4a61-13f4-42ad-5c7da6951d35.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	any	t	\N	CP6	Cake	\N
ae205022-f051-8b23-a553-fd6c3a0f7067	281	Пони	\N	creature	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ae205022-f051-8b23-a553-fd6c3a0f7067.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	any	t	\N	CP6	Fiona	\N
ae721416-6f82-434f-8d22-ab3e8dd6c87e	271	Плюшевый	Выбери существо под своим контролем, нанеси ему урон равный его ATK и затем удвой его ATK в этом ходу.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ae721416-6f82-434f-8d22-ab3e8dd6c87e.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	good	f	\N	\N	\N	\N
afd18c4d-f595-4e03-99ca-fbc782ce4e45	300	Розовая сирена	Сбрось карту >>> Нанеси 1 Урон каждому существу противника. (Используй только один раз в каждый свой ход.)	creature	2	2	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/afd18c4d-f595-4e03-99ca-fbc782ce4e45.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	swamp	f	\N	\N	\N	\N
afd4e817-701c-41ae-86cb-c2216f044d9e	210	Мышь альбинос	Пока на Мыше альбиносе ровно 2 Урона, она получает +2 ATK.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/afd4e817-701c-41ae-86cb-c2216f044d9e.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	good	f	\N	\N	\N	\N
b0c57480-a382-43fa-aa27-6b81a3620bd0	132	Крок-детектив	Сбрось карту >>> Открой 3 верхние карты своей колоды. Сыграй открытое партнерство бесплатно, затем сбрось другие карты.	creature	2	3	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b0c57480-a382-43fa-aa27-6b81a3620bd0.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	swamp	f	\N	\N	\N	\N
b196dd4c-b1ef-4686-b86c-875bdb561c14	170	Ледяной душегуб	Ледяной душегуб вступает в игру только на земли с ледяным жетоном.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b196dd4c-b1ef-4686-b86c-875bdb561c14.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
b1e4abf6-db47-4604-b470-aae9a235aaf2	376	Царственный олень	ПРИЕМ >>> Тяни карту за каждую землю с ледяным жетоном под контролем игроков.	creature	2	4	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b1e4abf6-db47-4604-b470-aae9a235aaf2.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	ice	f	\N	\N	\N	\N
b23481c4-04b9-4dbf-a8cb-428a7c296663	169	Ледяной дракон	Потрать 1 Действие >>> Заморозь землю на этой линии.	creature	2	2	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b23481c4-04b9-4dbf-a8cb-428a7c296663.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
b377455b-733e-401d-9a97-60da5b6c9772	43	Ведьмак	Когда враг сбрасывает карту, нанеси ему 1 Урон.	creature	2	1	11	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b377455b-733e-401d-9a97-60da5b6c9772.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	swamp	f	\N	\N	\N	\N
d39eda70-52df-4612-bd5f-a79e86b78eb2	353	Ультра пес	ПРИЕМ >>> Заморозь выбранную землю и существо на ней.	creature	2	3	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d39eda70-52df-4612-bd5f-a79e86b78eb2.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	ice	f	\N	\N	\N	\N
b45304e2-3a31-4ed4-ac71-6218ba1643f6	127	Крепость из подушек	Потрать 1 Действие, ПРИЕМ >>> Восстанови или нанеси 2 урона выбранному существу под твоим контролем на этой земле. Проделай то же самое с другим дружественным существом.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b45304e2-3a31-4ed4-ac71-6218ba1643f6.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	good	f	\N	\N	\N	\N
b465c176-75a7-4aca-8369-f6b2712ba706	179	Лунный урожай	Верни строение из стопки сброса себе в руку.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b465c176-75a7-4aca-8369-f6b2712ba706.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	corn	f	\N	\N	\N	\N
b6c06e74-a2e8-4e80-9128-1eeff3d7cc5e	116	Кормежник	Когда Кормежник вступает в игру, следующее существо введённое в игру в этом ход будет стоить на 1 меньше.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b6c06e74-a2e8-4e80-9128-1eeff3d7cc5e.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	corn	f	\N	\N	\N	\N
b735bc4c-4be4-4fc0-8119-d775a8c1de31	331	Статичный поп-десапт	Когда Статичный поп-десапт вступает в игру, перемести его на пустую землю. Его нельзя заменить. В начале своего следующего хода нанеси 1 урон своему герою.	creature	0	0	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b735bc4c-4be4-4fc0-8119-d775a8c1de31.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	any	t	\N	\N	\N	\N
b75a4a4a-eb49-a0ab-fa24-5a0abab25719	219	Невероятный опоссум	Когда эта карта оказывается в твоей стопке сброса, можешь сбросить карту с руки чтобы вернуть Невероятного опоссума себе в руку.	creature	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b75a4a4a-eb49-a0ab-fa24-5a0abab25719.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	blue	f	\N	CP6	Fiona	\N
b813f8a1-8306-4ffe-b410-b629bc167da9	109	Клон	Сыграй свое следующее существо или строение бесплатно, если существо или строение с таким же именем уже в игре.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b813f8a1-8306-4ffe-b410-b629bc167da9.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	any	t	\N	\N	\N	\N
b892b2b6-c971-4042-a758-92ed9296f38a	94	Звон магических колец	Каждое твоё существо получает +1 ATK этот ход за каждые 5 карт в твоей стопке сброса.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b892b2b6-c971-4042-a758-92ed9296f38a.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
b9de05b8-6f96-4c27-a9fe-a15ba6c6654c	113	Колбою змееглаза	Верни случайное большое существо из своей стопки сброса себе в руки.	creature	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/b9de05b8-6f96-4c27-a9fe-a15ba6c6654c.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	any	t	\N	\N	\N	\N
bbd0a576-665a-4500-98a6-1305cffe837c	11	Аэромансер	Когда Аэромансер вступает в игру, можешь поменять местами 2 существ выбранного игрока.	creature	2	3	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/bbd0a576-665a-4500-98a6-1305cffe837c.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	blue	f	\N	\N	\N	\N
bc31030c-fb94-454b-a228-27e2da9384db	68	Док Смерть	Уничтожь существо под своим контролем, ПРИЕМ >>> Уничтожь выбранное существо на этой линии.	creature	1	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/bc31030c-fb94-454b-a228-27e2da9384db.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
bc73916f-aefe-42e1-bfa5-23497f11fc07	249	Перекрёстное опыление	Каждое твоё Кукурузное существо получает +1 ATK в этом ходу за каждый уникальный тип земель под твоим контролем.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/bc73916f-aefe-42e1-bfa5-23497f11fc07.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
bcb7b27b-ddd8-4b76-aa46-5a061cd4892d	154	Куча мала	Дружественные существа получают +1 ATK до начала следующей фазы сражения. Затем каждое существо наносит урон равный его ATK существу противника на этой линии.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/bcb7b27b-ddd8-4b76-aa46-5a061cd4892d.png	2026-08-11 13:56:59.500323+00	2026-08-12 10:19:13.291904+00	good	f	\N	\N	\N	\N
bd8d8986-054d-41e6-9b27-b0449e92f84e	122	Костяная палочка	Играй только если под твoим контролем есть существо больших земель. Выбраный противник сбрасывает карту.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/bd8d8986-054d-41e6-9b27-b0449e92f84e.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	any	t	\N	\N	\N	\N
bdaf3344-d51c-4c0d-85c5-3255191f020f	288	Принцесса Банши	Когда Принцесса Банши вступает в игру, можешь убрать жетон с соседней земли.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/bdaf3344-d51c-4c0d-85c5-3255191f020f.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	swamp	f	\N	\N	\N	\N
bdd42340-8682-1677-b01d-f519cf250ee3	290	Пси-фехтовальщик	Когда Пси-фехтовальщик вступает в игру, можешь нанести 3 урона выбранному применённому существу.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/bdd42340-8682-1677-b01d-f519cf250ee3.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	blue	f	\N	CP6	Fiona	\N
bddef5c5-1e0a-4884-af24-e27e272b2b4f	177	Ловкий песчаный краб	Каждый раз когда во время твоего хода существо вступает в игру, можешь поменять их местами с Ловким песчаным крабом.	creature	1	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/bddef5c5-1e0a-4884-af24-e27e272b2b4f.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	sand	f	\N	\N	\N	\N
be0c8d5d-4d0c-4eed-af30-8847d3cea766	74	Древо-нежить	ПРИЕМ >>> Верни случайное существо из своей стопки сброса себе в руку.	creature	1	3	3	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/be0c8d5d-4d0c-4eed-af30-8847d3cea766.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
be125807-81fe-4c79-9be9-7eee011e2047	278	Полюс холода	Заморозь каждую землю твоего противника.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/be125807-81fe-4c79-9be9-7eee011e2047.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	ice	f	\N	\N	\N	\N
bffbe245-1708-4ca0-9d47-71076468639e	218	Невезучий поп-десапт	Когда Невезучий поп-десапт вступает в игру, перемести его на пустую землю. Его нельзя заменить. В начале своего хода сбрось карту.	creature	1	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/bffbe245-1708-4ca0-9d47-71076468639e.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
c01a55b6-f4a3-4dfd-a8ed-297ea1ed14c3	118	Королева Банши	Когда Королева Банши вступает в игру, можешь убрать жетон с соседней земли.	creature	2	3	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c01a55b6-f4a3-4dfd-a8ed-297ea1ed14c3.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	swamp	f	\N	\N	\N	\N
c066bcfd-cb90-488d-ab94-d54e6d3e7271	88	Замороженный патрилег	Когда Замороженный патрилег вступает в игру, можешь заморозить Землю на этой линии.	creature	1	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c066bcfd-cb90-488d-ab94-d54e6d3e7271.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	ice	f	\N	\N	\N	\N
c16c7d6b-f57c-4700-9c3c-53d69f9ff9c1	371	Хлопкопульт	ПРИЕМ >>> Нанеси 1 урон выбранному существу. Если на Хлопкопульте 5 урона или более, она восстанавливает 1 урон и подготавливается.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c16c7d6b-f57c-4700-9c3c-53d69f9ff9c1.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	good	f	\N	\N	\N	\N
c198d6a0-9c43-49c1-83ab-430ecac4a939	199	Мисс Пушника	Пока на Мисс Пушнике ровно 7 Урона, она получает +7 ATK.	creature	2	2	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c198d6a0-9c43-49c1-83ab-430ecac4a939.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	good	f	\N	\N	\N	\N
c261ef94-6821-ddef-0f8f-d46fbbe43ac3	368	Хитрый Леонард	Каждый раз когда Хитрый Леонард получает урон, тяни карту.	creature	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c261ef94-6821-ddef-0f8f-d46fbbe43ac3.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	CP1	Finn	\N
c38fe28d-0479-4c30-b54a-70b9694691fb	284	Посох вуду	Нанеси урон выбранному существу пока у него не останется 1 DEF.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c38fe28d-0479-4c30-b54a-70b9694691fb.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	swamp	f	\N	\N	\N	\N
c41d1804-b5fb-4ac1-af0b-31ad034f1ecc	198	Мисс Муми	В начале своего хода можешь вернуть Мисс Муми в руку владельцу. Если сделаешь это, выбранное Песчаное Существо под твоим контролем получает +1 DEF.	creature	0	1	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c41d1804-b5fb-4ac1-af0b-31ad034f1ecc.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	\N	\N	\N
c46d6947-0e5c-4813-86b4-9cfd94726cba	197	Мимик	В начале своего хода нанеси 3 урона каждому противнику без карт в руке.	creature	1	1	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c46d6947-0e5c-4813-86b4-9cfd94726cba.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	swamp	f	\N	\N	\N	\N
c4d524b3-b951-4a09-b4f6-baf6f7e8572a	40	Бывалый зебрагон	Когда Бывалый зебрагон атакует, нанеси 2 урона выбранному противнику.	creature	2	2	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c4d524b3-b951-4a09-b4f6-baf6f7e8572a.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	corn	f	\N	\N	\N	\N
c51317ee-c6ac-4b42-a3d9-44588592e315	264	Пещера одиночества	Сбрось карту >>> Твоё существо на этой линии может быть атаковано или выбрано до начала твоего следующего хода.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c51317ee-c6ac-4b42-a3d9-44588592e315.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	good	f	\N	\N	\N	\N
c62705c8-53d3-42e0-8f51-421ec70f06f5	66	Дикий зебрагон	Когда Зеленый зебрагон атакует, нанеси 1 урон выбранному противнику.	creature	1	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c62705c8-53d3-42e0-8f51-421ec70f06f5.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	corn	f	\N	\N	\N	\N
c662fa55-8df0-4f95-ac29-80d560ba7b29	285	Предводитель Вайда	В начале своего хода перемести Предводителя Вайда на пустую землю под твоим контролем. Если не смог, то сбрось его.	creature	1	3	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c662fa55-8df0-4f95-ac29-80d560ba7b29.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	any	t	\N	\N	\N	\N
c670ebda-5c1c-4897-8137-62289b57a723	217	Набитый орангутан	Пока у Набитого орангутана 4 и более урона, его ATK удваивается.	creature	2	2	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c670ebda-5c1c-4897-8137-62289b57a723.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	good	f	\N	\N	\N	\N
c69d3460-b4bb-4165-a095-57ff211c4f6a	23	Беспредельная фигура	Сбрось карту >>> Нанеси 1 урон другому существу на этой линии. (Используй любое количество раз в каждый свой ход.)	creature	1	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c69d3460-b4bb-4165-a095-57ff211c4f6a.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	swamp	f	\N	\N	\N	\N
c6e0153f-6ce7-494e-a1e6-48f1daf5b927	92	Зашибленный водила	ПРИЕМ >>> Нанеси 3 урона выбранному существу на земле с ледяным жетоном.	creature	1	0	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c6e0153f-6ce7-494e-a1e6-48f1daf5b927.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	ice	f	\N	\N	\N	\N
c7ab0f6e-9fdb-4643-8043-dba35acf255e	229	Огненное торнадо	ПРИЕМ >>> Огненное торнадо получает +3 ATK пока применено.	creature	2	0	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c7ab0f6e-9fdb-4643-8043-dba35acf255e.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	corn	f	\N	\N	\N	\N
c801c4d1-781f-3d10-bb17-f1aba459ce80	303	Рука помощи	ПРИЕМ >>> Верни строение из стопки сброса себе в руку.	spell	0	1	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c801c4d1-781f-3d10-bb17-f1aba459ce80.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	any	t	\N	CP6	Cake	\N
c838729a-e9e2-4f16-bc4f-aa0d01f06cda	392	Яблочный пироклон	В начале твоего хода можешь восстановить или нанести 1 урон с каждого существа под твоим контролем. (Выбери для каждого существа.)	creature	2	1	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c838729a-e9e2-4f16-bc4f-aa0d01f06cda.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	good	f	\N	\N	\N	\N
c83a9cb6-430c-c5d9-3b80-1bb3b26d5d04	149	Кукурузный монах	Каждый раз когда Кукурузный монах атакует, можешь тянуть карту.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c83a9cb6-430c-c5d9-3b80-1bb3b26d5d04.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	CP1	Jake	\N
c8c6eccd-a594-0e99-33c9-6d482e7eed8d	178	Лорд Вампиров	Когда Лорд Вампиров наносит урон, он восстанавливает то же количество урона у себя.	creature	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/c8c6eccd-a594-0e99-33c9-6d482e7eed8d.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	CP6	Fiona	\N
ca467fb5-afe2-4a9a-8736-af21c72c7620	70	Домик из разного дерева	Домик из разного дерева стоит на 1 меньше за каждое применённое существо под твоим контролем. Твоё существо на этой линии получает +5 DEF.	building	5	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ca467fb5-afe2-4a9a-8736-af21c72c7620.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	corn	f	\N	\N	\N	\N
cbd1c873-3718-4ebf-aeba-be7c7fb09a35	311	Сила подсознания	Выбранное существо под твоим контролем получает +2 ATK в этом ход, за каждое заклинание (включая это) сыгранное тобой в этом ход.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/cbd1c873-3718-4ebf-aeba-be7c7fb09a35.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	blue	f	\N	\N	\N	\N
cc2f7221-7a5d-47e2-87ae-e4931ca9c31d	321	Снежная лавина	Нанеси 2 урона каждому существу противника на земле с ледяными фишками.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/cc2f7221-7a5d-47e2-87ae-e4931ca9c31d.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	any	t	\N	\N	\N	\N
cd7120e4-9f69-48d1-9048-ed625e5e6a00	52	Вырубка леса	Дополнительная стоимость: примени существо под твоим контролем. Просмотри свою колоду в поисках строения и введи его в игру. Затем перемешай свою колоду.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/cd7120e4-9f69-48d1-9048-ed625e5e6a00.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	corn	f	\N	\N	\N	\N
cd8b183d-9c9d-4d2e-b093-ec866b7e7a44	100	Зона высадки	Выбери своё существо и верни его на руку.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/cd8b183d-9c9d-4d2e-b093-ec866b7e7a44.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	any	t	\N	\N	\N	\N
ce410124-147c-4276-9057-d9b93d96a5b7	15	Башня Духа	Потрать 1 действие, ПРИЕМ >>> Если ты не контролируешь существ на этой линии, то перемести выбранное существо на свою сторону и подгони его. В конце хода верни его на сторону владельца.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ce410124-147c-4276-9057-d9b93d96a5b7.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	swamp	f	\N	\N	\N	\N
cefeb98c-f664-4e47-89bb-8f2adf9a7f70	140	Крушитель земли	Когда Крушитель земли вступает в игру, переверни землю на этой линии лицом вниз. Когда он покидает игру, переверни её лицом вверх.	creature	1	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/cefeb98c-f664-4e47-89bb-8f2adf9a7f70.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	corn	f	\N	\N	\N	\N
cf269ef4-cfa1-4ad9-a423-540ed2698fd9	120	Королевский тур	Если выбранное существо под твоим контролем наносит 1 и более урона противнику в этом ход, то нанеси 2 урона этому же противнику. Как сделал это, передай карту в руку своему партнеру.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/cf269ef4-cfa1-4ad9-a423-540ed2698fd9.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	any	t	\N	\N	\N	\N
d049c17e-0097-4bb7-980f-286de5e8d100	13	Бабах	Когда Бабах покидает игру нанеси 1 урон каждому соседнему существу.	creature	0	0	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d049c17e-0097-4bb7-980f-286de5e8d100.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
d1c588e5-ee46-42ed-86cf-558355c76ae0	248	Пень с булавой	\N	creature	1	3	3	t	Выбранный противник сбрасывает карту за каждые 5 карт в твоей стопке сброса.	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d1c588e5-ee46-42ed-86cf-558355c76ae0.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	swamp	f	\N	\N	\N	\N
d2730724-3fa7-4341-82fb-a8b4efc16614	33	Бондарь	ПРИЕМ >>> Выбери существо под контролем твоего партнёра. +1 ATK сколько стоит партитнер команды.	creature	2	3	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d2730724-3fa7-4341-82fb-a8b4efc16614.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	good	f	\N	\N	\N	\N
d2fd6ffa-ab9e-4506-bf09-80eb38e42106	1	Абрака Амадеус	Выбранный противник сбрасывает карту за каждые 5 карт в твоей стопке сброса.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d2fd6ffa-ab9e-4506-bf09-80eb38e42106.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	swamp	f	\N	\N	\N	\N
d3284a2e-3728-49f6-8733-720f791dc2a9	388	Школа	ПРИЕМ >>> Твоё существо на этой линии теряет все способности и получает Прием случайного существа (с приемом) из твоей стопки сброса до конца хода.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d3284a2e-3728-49f6-8733-720f791dc2a9.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:48:52.253741+00	blue	f	\N	\N	\N	\N
d3453e07-908b-43c1-a169-65a04f4ba779	115	Кольцо пушистости	Выбранное существо под твоим контролем получает +X ATK в этом ходу, где X это число урона на нем.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d3453e07-908b-43c1-a169-65a04f4ba779.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	good	f	\N	\N	\N	\N
d3995422-83f3-4abc-b023-9cd11e903faa	201	Моккотем	Потрать 1 Действие, ПРИЕМ >>> Нанеси 2 урона выбранному существу. Если это существо погибло, заморозь землю под ним.	creature	1	0	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d3995422-83f3-4abc-b023-9cd11e903faa.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
d3a97f75-1a6b-d532-1682-202fc3f63274	287	Призрак полей	В начале твоего хода каждый царёк тянет карту.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d3a97f75-1a6b-d532-1682-202fc3f63274.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	any	t	\N	CP1	Jake	\N
d43571d6-808b-4bd2-84f9-f77666c43bde	63	Дворец Костей	У существ противника на этой линии не срабатывают эффекты вступления в игру и покидания игры.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d43571d6-808b-4bd2-84f9-f77666c43bde.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
d467b1d2-2d3e-9c1d-4e64-5a20a178a93f	318	Смесияшка Бард	ПРИЕМ >>> Тяни карту за каждое применённое существо под твоим контролем (включая это).	creature	2	1	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d467b1d2-2d3e-9c1d-4e64-5a20a178a93f.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	blue	f	\N	CP1	Finn	\N
d49826b4-12f6-fc29-0258-961dda1f8963	384	Чудик Вайда	ПРИЕМ >>> Покажи карту с руки. До конца твоего хода эта карта становится Радужной. (У неё нет типа Земли.)	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d49826b4-12f6-fc29-0258-961dda1f8963.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	CP6	Fiona	\N
d4b5e1b4-d4ad-465a-ac1c-3196c36a5f49	46	Виноградная Джинни	Когда Виноградная Джинни вступает в игру замени существо, можешь положить карту из стопки сброса на верх своей колоды.	creature	1	1	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d4b5e1b4-d4ad-465a-ac1c-3196c36a5f49.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	any	t	\N	\N	\N	\N
d7a51d26-a7d0-402f-a5a3-4df6a83dd96a	363	Фея Шепард	Каждое соседнее милое существо получает +2 DEF.	creature	2	2	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d7a51d26-a7d0-402f-a5a3-4df6a83dd96a.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	good	f	\N	\N	\N	\N
d819b7d7-8f6e-42de-8d58-dfb6ce9dbcd4	308	Семейные посиделки	Выбери другое игрока и землю под твоим контролем. Каждый тянет карту существа соответствующего этой земле.	spell	0	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d819b7d7-8f6e-42de-8d58-dfb6ce9dbcd4.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	any	t	\N	\N	\N	\N
d8408690-b25b-4ae0-9097-fe2840e778f2	80	Заводской убийца	Уничтожь существо под твоим контролем, ПРИЕМ >>> Вытяни карту.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d8408690-b25b-4ae0-9097-fe2840e778f2.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	any	t	\N	\N	\N	\N
d89a2091-bee7-4618-be33-d3818c81327f	221	Некромансер	Каждый раз, когда существо под твоим контролем покидает игру, можешь переместить Некромансера на пустую землю под твоим контролем.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d89a2091-bee7-4618-be33-d3818c81327f.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	blue	f	\N	\N	\N	\N
d8d3e7b6-1d4b-4c86-8e5d-bc0ffb5f4c5d	365	Фолианкх	Тяни карту за каждую свою пустую линию.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d8d3e7b6-1d4b-4c86-8e5d-bc0ffb5f4c5d.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	sand	f	\N	\N	\N	\N
d99ad950-5296-4285-a38c-8dfed74df0bd	289	Просвещение	Посмотри 4 верхние карты в колоде выбранного игрока и верни их обратно в любом порядке. Затем тяни карту.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/d99ad950-5296-4285-a38c-8dfed74df0bd.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	blue	f	\N	\N	\N	\N
da711ace-1ce4-49e6-9bab-29ba32152bca	394	Яростная цыпа	Яростная цыпа получает +1 ATK за каждый урон на ней.	creature	0	0	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/da711ace-1ce4-49e6-9bab-29ba32152bca.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	any	t	\N	\N	\N	\N
da78a028-7c5f-4118-ae1c-0af388512d09	185	Магокража	Сыграй только, если под твоим контролем не более 1 существа и у тебя не более 15 HP. Перемести выбранное существо на выбранную линию под твоим контролем.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/da78a028-7c5f-4118-ae1c-0af388512d09.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	any	t	\N	\N	\N	\N
dac829dc-c627-42eb-b3c8-fc576f34f5e2	254	Пескомаг	В начале своего хода можешь вернуть Пескомага в руку его владельца. Если сделаешь это, каждое существо под твоим контролем получает +1 в этом ход.	creature	1	2	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/dac829dc-c627-42eb-b3c8-fc576f34f5e2.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
dafe14f2-d6ef-4d91-9da5-79e0286fa195	163	Ледяная снегобаба	Когда Ледяная снегобаба вступает в игру заморозь обе земли на её линии.	creature	2	3	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/dafe14f2-d6ef-4d91-9da5-79e0286fa195.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	ice	f	\N	\N	\N	\N
dbf7b725-76bc-45ee-9dfc-24c4f33eddcf	258	Песчаная мышь	Песчаная мышь получает 1 DEF за каждое существо вступившее в игру под твоим контролем.	creature	2	1	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/dbf7b725-76bc-45ee-9dfc-24c4f33eddcf.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
dc5369c6-cce8-39a9-2435-5e8026df6745	189	Матриарх Вайда	Матриарх Вайда получает +1 АТК за каждое Радужное существо под твоим контролем.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/dc5369c6-cce8-39a9-2435-5e8026df6745.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	blue	f	\N	CP6	Fiona	\N
ddafd5c3-4e1b-45c5-b471-875cde169fc3	390	Шоколадный ангел	Потрать 1 Действие >>> Восстанови весь урон с Ангела шоколада.	creature	2	3	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ddafd5c3-4e1b-45c5-b471-875cde169fc3.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	good	f	\N	\N	\N	\N
de3007dc-75a1-48a8-b958-645fbb6f1672	391	Щенок в заплатках	Нанеси 3 урона Щенку в заплатках >>> Он получает +2 ATK в этом ходу.	creature	2	3	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/de3007dc-75a1-48a8-b958-645fbb6f1672.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	good	f	\N	\N	\N	\N
de3028bd-0067-636a-c2c9-af5095da96c9	280	Помощник лесоруба	ПРИЕМ >>> Перемести выбранное строение под твоим контролем на любую землю без строения.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/de3028bd-0067-636a-c2c9-af5095da96c9.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	corn	f	\N	CP6	Cake	\N
df57fbe5-71d3-472a-b2e9-81113fbc415e	276	Подмога	В начале фазы сражения твоего или твоего партнёра, если или партнер сыграл существо стоимостью 2 и более в этом ход, другой партнер может тянуть карту.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/df57fbe5-71d3-472a-b2e9-81113fbc415e.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
dfa50411-7342-4e4e-ba02-f01fcd07597f	193	Милашка	ПРИЕМ >>> Восстанови себе 1 HP. (Но не более 25.)	creature	1	0	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/dfa50411-7342-4e4e-ba02-f01fcd07597f.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	good	f	\N	\N	\N	\N
e157beec-e1ed-44d6-81bd-6c83962e4dc3	62	Дай пять!	Восстанови или нанеси 1 урон выбранному существу. Как сделал это, можешь передать своего партнера Радужное заклинание той же стоимости бесплатно.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/e157beec-e1ed-44d6-81bd-6c83962e4dc3.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	any	t	\N	\N	\N	\N
e408acdf-7b80-71f8-cd11-9f79c9d6a4d7	305	Свин	ПРИЕМ >>> Выбери и переверни Кукурузное поле на этой линии лицом вниз.	creature	1	0	0	f	\N	[]		2026-08-11 13:57:04.512802+00	2026-08-16 18:40:35.733845+00	any	t	\N	CP1	Finn	\N
e5971cbd-000e-41cf-90dc-c761f4c1ad20	320	Смотритель небес	ПРИЕМ >>> Помести заклинание из своей стопки сброса наверх своей колоды.	creature	1	2	5	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/e5971cbd-000e-41cf-90dc-c761f4c1ad20.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	blue	f	\N	\N	\N	\N
e5e29ff7-28e6-49b4-a37a-b09c39d9295f	61	Гусеничка	+2 ATK за каждые 5 карт в твоей стопке сброса.	creature	2	0	3	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/e5e29ff7-28e6-49b4-a37a-b09c39d9295f.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
e6aca443-b57d-4d50-a967-c13d25996add	228	Овечка	В начале твоего хода можешь заставить Овечку нанести себе 1 урон и подготовиться.	creature	0	2	3	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/e6aca443-b57d-4d50-a967-c13d25996add.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
e73ba017-aa33-414b-a64b-e8feac40ba1f	256	Песочный краб пират	Когда песочный краб пират вступает в игру, можешь бесплатно сыграть существо стоимостью 1.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/e73ba017-aa33-414b-a64b-e8feac40ba1f.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
e82b5601-8cef-41ca-ae3b-cc3fc07745e5	78	Желтая сирена	Рагужное существо	creature	2	3	9	f	Уничтожь Зеленую сирену >>> Нанеси 1 урон каждому существу противника.	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/e82b5601-8cef-41ca-ae3b-cc3fc07745e5.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	any	t	\N	\N	\N	\N
e89958b1-fee0-dadc-9ae6-85a381ad0f29	231	Одинокая панда	Когда одинокая панда вступает в игру и под твоим контролем нет других существ, тяни карту.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/e89958b1-fee0-dadc-9ae6-85a381ad0f29.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	blue	f	\N	CP6	Fiona	\N
e9d7a323-2500-4c01-881f-ceff63f34da7	187	Мариачи	ПРИЕМ >>> Нанеси 1 урон выбранному существу за каждое существо вступившее в игру в этом ходу.	creature	2	2	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/e9d7a323-2500-4c01-881f-ceff63f34da7.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	sand	f	\N	\N	\N	\N
ea4e7b5c-211c-437c-a8f1-236ec0858cc1	230	Один в один	Вытащи 2 верхние карты из своей колоды. Если они одинаковой стоимости нанеси урон выбранному противнику. Как сделал это, можешь вложить эту карту в руку партнера.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ea4e7b5c-211c-437c-a8f1-236ec0858cc1.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	any	t	\N	\N	\N	\N
eaa11cff-4d19-46f6-8742-a9cda948832c	41	Ванна крови	Выбранный враг сбрасывает карту стоимостью 2 или более. Если нет, то нанеси 5 урона этому врагу.	spell	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/eaa11cff-4d19-46f6-8742-a9cda948832c.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:58.520254+00	swamp	f	\N	\N	\N	\N
eabf35b6-89d0-462c-a213-b17c04ad03ab	155	Лавина маиса	Каждое твоё существо получает +1 ATK в этом ходу за каждую землю в игре, перевернутую лицом вниз.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/eabf35b6-89d0-462c-a213-b17c04ad03ab.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:05.12985+00	corn	f	\N	\N	\N	\N
ec0915e8-7307-b576-34fd-d6cac8a82117	378	Центр знаний	Центр знаний получает игровой текст строений под твоим контролем на соседних линиях. (но не их имена.)	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ec0915e8-7307-b576-34fd-d6cac8a82117.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	CP6	Fiona	\N
ecc1b12f-ee41-4346-9ea0-4c9027bb380e	265	Пирамида	ПРИЕМ >>> Если контролируешь существо на этой линии, получи 1 действие. Используй его только чтобы играть существо на эту линию.	building	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ecc1b12f-ee41-4346-9ea0-4c9027bb380e.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	blue	f	\N	\N	\N	\N
ecf991aa-bd56-4c6e-84ea-7cb8e5763bd8	295	Разбитое партнерство	В первый раз когда ты или твой партнер сделаешь партнерское заклинание или партнерское строение Радужное, все заключения того же типа этого хода стоят бесплатно.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ecf991aa-bd56-4c6e-84ea-7cb8e5763bd8.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	any	t	\N	\N	\N	\N
ede6a57c-eac8-493d-86fa-d7c8569c6e98	319	Смещатель земли	+2 ATK за каждую землю в игре перевернутую лицом вниз.	creature	2	2	10	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ede6a57c-eac8-493d-86fa-d7c8569c6e98.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	corn	f	\N	\N	\N	\N
ee0caf1c-bacf-4a70-be2a-48de76fffdd2	315	Скачущий зебрагон	+1 ATK за каждый различный тип земли под твоим контролем.	creature	2	1	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ee0caf1c-bacf-4a70-be2a-48de76fffdd2.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	corn	f	\N	\N	\N	\N
ee3a33d6-cfbd-4922-a94f-5bbe6721ddf2	370	Хлопковая мышь	Пока на Хлопковой мыши ровно 4 урона, она получает +4 ATK.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ee3a33d6-cfbd-4922-a94f-5bbe6721ddf2.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	good	f	\N	\N	\N	\N
ee509393-99c3-4a16-a611-ef14eba5bdc9	286	Привлекательный слон	Каждый раз когда Привлекательный слон становится целью заклинания противника, нанеси 2 урона выбранному существу противника.	creature	2	4	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ee509393-99c3-4a16-a611-ef14eba5bdc9.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.142986+00	good	f	\N	\N	\N	\N
ee992d35-e6c6-4b5f-8b03-3813caf62ef8	7	Ангел-болот Банши	Потрать 1 Действие >>> Перемести весь урон с этого существа на выбранное существо.	creature	2	2	7	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ee992d35-e6c6-4b5f-8b03-3813caf62ef8.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:18:58.520254+00	swamp	f	\N	\N	\N	\N
ef93e0c1-7333-47fc-a77a-d5d28972054c	334	Стена шоколада	Пока на Стене шоколада нет урона, она получает +3 ATK.	creature	2	1	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/ef93e0c1-7333-47fc-a77a-d5d28972054c.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	good	f	\N	\N	\N	\N
f04044ed-e05c-470c-8186-08167d3ab96a	357	Усталый библиотекарь	Усталый библиотекарь вступает в игру неактивным и не подготовлен в начале твоего хода. Всякий раз, когда он меняет линию, подготовь его.	creature	1	3	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f04044ed-e05c-470c-8186-08167d3ab96a.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:08.749969+00	any	t	\N	\N	\N	\N
f07beaf0-bfca-5d8e-16d0-06d87d163a22	380	Чародейка Вайда	Существа на этой линии не могут использовать Приёмы.	creature	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f07beaf0-bfca-5d8e-16d0-06d87d163a22.png	2026-08-11 13:57:06.515983+00	2026-08-11 14:19:08.749969+00	blue	f	\N	CP6	Fiona	\N
f1433fba-dec6-3e5b-4ac2-ac5b54a97cf8	313	Сияющая Броня	Выбранное существо получает +3 DEF в этом ходу. Нарисуй карту.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f1433fba-dec6-3e5b-4ac2-ac5b54a97cf8.png	2026-08-11 13:57:04.512802+00	2026-08-11 14:19:07.906449+00	blue	f	\N	CP1	Finn	\N
f1860cc1-713f-4f89-b480-e4473beaf327	135	Крок-каскадер	Когда Крок-каскадер вступает в игру, тяни карту за каждое существо, которое отправилось в сброс в этом ход.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f1860cc1-713f-4f89-b480-e4473beaf327.png	2026-08-11 13:56:59.500323+00	2026-08-11 14:19:04.196007+00	swamp	f	\N	\N	\N	\N
f25dbeb8-e618-477d-94d5-40d9fee1bfad	72	Драконий поп-десапт	Когда Драконий поп-десапт вступает в игру, перемести его на пустую землю. Его нельзя заменить. Соседние существа получают -1 ATK.	creature	2	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f25dbeb8-e618-477d-94d5-40d9fee1bfad.png	2026-08-11 13:56:55.741397+00	2026-08-11 14:18:59.496783+00	any	t	\N	\N	\N	\N
f290116f-2e09-47e2-b42d-03db7874af7e	5	Альфа-йети	+3 ATK пока твой противник не контролирует существо на этой линии.	creature	1	3	2	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f290116f-2e09-47e2-b42d-03db7874af7e.png	2026-08-11 13:56:54.669194+00	2026-08-16 18:41:24.88942+00	ice	f	\N	\N	\N	\N
f2cbe886-d826-48b0-9013-b0052f3abf63	340	Сэндвич	Когда Сэндвич или другое песчаное существо вступает в игру под твоим контролем, нанеси 1 урон своему противнику.	creature	1	0	12	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f2cbe886-d826-48b0-9013-b0052f3abf63.png	2026-08-11 13:57:05.620581+00	2026-08-11 14:19:07.906449+00	sand	f	\N	\N	\N	\N
f325dcba-3df3-45d4-b4ab-0034e3a496af	188	Мародер Вайда	Когда Мародер Вайда меняет линию во время хода, тяни карту.	creature	2	3	9	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f325dcba-3df3-45d4-b4ab-0034e3a496af.png	2026-08-11 13:57:00.626251+00	2026-08-11 14:19:05.12985+00	blue	f	\N	\N	\N	\N
f42845d5-1793-4aa7-a5e4-91d1b3ce7072	207	Муми Ба	В начале своего хода можешь вернуть Муми Ба в руку его владельца. Если сделаешь это, тяни две карты.	creature	1	3	3	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f42845d5-1793-4aa7-a5e4-91d1b3ce7072.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	sand	f	\N	\N	\N	\N
f51ce835-5c07-4eaf-bbe6-b7cb5c6fac2f	225	Облачная башня	Твоё существо на этой линии не может стать целью заклинания или способностей существ противника. ПРИЕМ >>> Перемести существо под твоим контролем на эту линию.	building	2	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f51ce835-5c07-4eaf-bbe6-b7cb5c6fac2f.png	2026-08-11 13:57:01.514989+00	2026-08-11 14:19:06.167967+00	blue	f	\N	\N	\N	\N
f5e3be67-ae25-4556-be2a-898001e1a1fb	107	Каракум	Когда существо под твоим контролем покидает игру, можешь подложить его под эту карту. +1 ATK и +1 DEF за каждую карту под ней. Когда она покидает игру, сбрось все карты под ней.	creature	1	0	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f5e3be67-ae25-4556-be2a-898001e1a1fb.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:19:04.196007+00	sand	f	\N	\N	\N	\N
f7a97331-86d8-47f3-89cc-092e6e91d6f1	279	Поля кошмаров	Наносим 1 урон противнику за каждую карту в его руке.	spell	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/f7a97331-86d8-47f3-89cc-092e6e91d6f1.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	corn	f	\N	\N	\N	\N
fac32a20-4061-474c-a5ab-644b2d330dbc	9	Архитектор разума	Когда Архитектор разума вступает в игру, можешь победить применённое существо под твоим контролем.	creature	1	2	6	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/fac32a20-4061-474c-a5ab-644b2d330dbc.png	2026-08-11 13:56:54.669194+00	2026-08-11 14:48:52.253741+00	blue	f	\N	\N	\N	\N
fb1b8c0b-fa19-a6aa-4a79-d3119961d94b	245	Пакет Булочка	Твои существа на этой линии получают +1 ATK.	creature	1	0	0	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/fb1b8c0b-fa19-a6aa-4a79-d3119961d94b.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:06.167967+00	blue	f	\N	CP1	Finn	\N
fbe45134-a0a0-43f8-92df-1b4fc2a23dab	101	Зубастик	+2 DEF за каждые 5 карт в твоей стопке сброса.	creature	1	2	4	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/fbe45134-a0a0-43f8-92df-1b4fc2a23dab.png	2026-08-11 13:56:56.668878+00	2026-08-11 14:18:59.496783+00	swamp	f	\N	\N	\N	\N
fe01b3be-7b88-4caf-80ce-3e4f111cee6b	259	Песчаные рыцари	+2 ATK если под твоим контролем Голубые равнины.	creature	1	1	8	f	\N	[]	https://<supabase-project>.supabase.co/storage/v1/object/public/card-images/cards/fe01b3be-7b88-4caf-80ce-3e4f111cee6b.png	2026-08-11 13:57:02.385584+00	2026-08-11 14:19:07.142986+00	sand	f	\N	\N	\N	\N
\.


--
-- Data for Name: deck_heroes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.deck_heroes (preset_deck_id, hero_number, is_primary, sort_order, created_at) FROM stdin;
252f010d-2203-546d-7f91-43d5722fdc64	3012	t	0	2026-08-24 10:44:24.267687+00
9acde64a-800d-1182-060d-62b37b0b7247	3006	t	0	2026-08-24 10:44:24.267687+00
a7aed08f-51fb-72aa-e963-66d8437603fa	3005	t	0	2026-08-24 10:44:24.267687+00
c618cbbd-3251-06a0-f173-4d973d9a3717	3009	t	0	2026-08-24 10:44:24.267687+00
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	3018	t	0	2026-08-24 10:44:24.267687+00
f3b9d46c-e56c-2206-ff51-586326d731bb	3016	t	0	2026-08-24 10:44:24.267687+00
\.


--
-- Data for Name: decks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.decks (id, user_id, name, code, cards, lands, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: game_chat; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.game_chat (id, game_id, player_id, message, created_at) FROM stdin;
\.


--
-- Data for Name: game_players; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.game_players (game_id, player_id, health, hand, deck_remaining, "position", created_at, updated_at, nickname, player_order, last_seen, deck_pile, discard_pile, land_setup_ready, actions_remaining, free_draw_used, paid_draw_used) FROM stdin;
\.


--
-- Data for Name: game_zones; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.game_zones (id, game_id, zone_position, player_id, cards, land_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: games; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.games (id, lobby_id, status, current_turn, current_player_id, game_state, created_at, updated_at, winner_id, started_at, ended_at, version, turn_started_at) FROM stdin;
\.


--
-- Data for Name: lands; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lands (id, name, land_type, description, image_url, created_at) FROM stdin;
02768b9d-a3b4-4712-9122-0408c773b3a0	Бесполезное болото	swamp	Болото без особых свойств.	\N	2026-06-18 11:45:20.676401+00
10e15aea-bd25-456b-bdd5-a12f8f0656bb	Ледяная земля	ice	Замедляет вражеских существ в этой зоне.	\N	2026-06-18 11:35:56.728687+00
2d53f35b-2d4c-4bd0-afb2-54a4006e600b	Пустынная земля	sand	Пустынный тип земли.	\N	2026-06-18 11:45:20.676401+00
5b4dc5e9-bcf4-45f3-a9a2-f31ef24dee32	Синяя равнина	blue	Равнинный тип земли.	\N	2026-06-18 11:45:20.676401+00
88495cef-482e-409a-bb8e-1a9f6ba02347	Кукурузное поле	corn	Основной тип земли. Даёт бонусы кукурузным существам.	\N	2026-06-18 11:35:56.728687+00
972ab8a9-2c50-4235-af8f-a26804d96b49	Добрая земля	good	Базовый тип земли.	\N	2026-06-18 11:45:20.676401+00
\.


--
-- Data for Name: lobbies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lobbies (id, code, host_id, status, deck_host, deck_guest, created_at, mode, turn_time_seconds, min_level, max_level, password, current_players, is_ranked, landscape, name, game_id) FROM stdin;
\.


--
-- Data for Name: lobby_players; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lobby_players (lobby_id, player_id, deck, ready, joined_at, nickname) FROM stdin;
\.


--
-- Data for Name: preset_deck_cards; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.preset_deck_cards (preset_deck_id, card_id, slot, is_landscape) FROM stdin;
25995a67-97f0-56ed-f260-e1b51baa1085	0bfde5fe-962c-4cac-8786-41306887d08b	20	f
25995a67-97f0-56ed-f260-e1b51baa1085	0bfde5fe-962c-4cac-8786-41306887d08b	21	f
25995a67-97f0-56ed-f260-e1b51baa1085	140365b7-588f-4fe2-8431-f9ee4f9eb1e5	6	f
25995a67-97f0-56ed-f260-e1b51baa1085	16b96fe2-455c-4c3f-a346-e4fdf3e43432	1	f
25995a67-97f0-56ed-f260-e1b51baa1085	16b96fe2-455c-4c3f-a346-e4fdf3e43432	2	f
25995a67-97f0-56ed-f260-e1b51baa1085	20cff4aa-ae37-4a35-be39-df7738bb2361	10	f
25995a67-97f0-56ed-f260-e1b51baa1085	20cff4aa-ae37-4a35-be39-df7738bb2361	11	f
25995a67-97f0-56ed-f260-e1b51baa1085	2949a9cf-7560-422e-beb3-e27e0e83a920	13	f
25995a67-97f0-56ed-f260-e1b51baa1085	2949a9cf-7560-422e-beb3-e27e0e83a920	14	f
25995a67-97f0-56ed-f260-e1b51baa1085	31dee8e7-d0ae-4f8a-897c-85ea95dcf56b	23	f
25995a67-97f0-56ed-f260-e1b51baa1085	3ecd0a25-be8f-4987-a356-2e2812a1e0ed	26	f
25995a67-97f0-56ed-f260-e1b51baa1085	3ecd0a25-be8f-4987-a356-2e2812a1e0ed	27	f
25995a67-97f0-56ed-f260-e1b51baa1085	4aba6ef2-c748-451c-a240-1a054578802b	40	f
25995a67-97f0-56ed-f260-e1b51baa1085	4d441fb7-162c-40fb-b1f8-418d758274d9	7	f
25995a67-97f0-56ed-f260-e1b51baa1085	5153f4c9-6303-4572-bc08-d48a3cf52eae	15	f
25995a67-97f0-56ed-f260-e1b51baa1085	5153f4c9-6303-4572-bc08-d48a3cf52eae	16	f
25995a67-97f0-56ed-f260-e1b51baa1085	6b02e3b0-9160-4fca-8eb9-8e763a370d80	4	f
25995a67-97f0-56ed-f260-e1b51baa1085	74618acc-175b-4caf-95b7-b36689ea76f3	29	f
25995a67-97f0-56ed-f260-e1b51baa1085	766142e4-df6c-490d-9720-388aec49be9c	22	f
25995a67-97f0-56ed-f260-e1b51baa1085	7698b207-bc0a-428a-97d8-25324581e209	28	f
25995a67-97f0-56ed-f260-e1b51baa1085	7ff90b5a-58b4-4983-8e65-dbf8f95d99b3	25	f
25995a67-97f0-56ed-f260-e1b51baa1085	8211dffc-b9d3-430e-8d99-eb6816401511	9	f
25995a67-97f0-56ed-f260-e1b51baa1085	843a00d1-1e31-4c0b-9839-00b283fd2216	19	f
25995a67-97f0-56ed-f260-e1b51baa1085	8a2cc3af-1080-415b-8115-4d6abbe5a4aa	24	f
25995a67-97f0-56ed-f260-e1b51baa1085	8a2cc3af-1080-415b-8115-4d6abbe5a4aa	39	f
25995a67-97f0-56ed-f260-e1b51baa1085	b45304e2-3a31-4ed4-ac71-6218ba1643f6	8	f
25995a67-97f0-56ed-f260-e1b51baa1085	b6c06e74-a2e8-4e80-9128-1eeff3d7cc5e	30	f
25995a67-97f0-56ed-f260-e1b51baa1085	b6c06e74-a2e8-4e80-9128-1eeff3d7cc5e	31	f
25995a67-97f0-56ed-f260-e1b51baa1085	b813f8a1-8306-4ffe-b410-b629bc167da9	34	f
25995a67-97f0-56ed-f260-e1b51baa1085	bcb7b27b-ddd8-4b76-aa46-5a061cd4892d	5	f
25995a67-97f0-56ed-f260-e1b51baa1085	c4d524b3-b951-4a09-b4f6-baf6f7e8572a	18	f
25995a67-97f0-56ed-f260-e1b51baa1085	c62705c8-53d3-42e0-8f51-421ec70f06f5	17	f
25995a67-97f0-56ed-f260-e1b51baa1085	c62705c8-53d3-42e0-8f51-421ec70f06f5	32	f
25995a67-97f0-56ed-f260-e1b51baa1085	cf269ef4-cfa1-4ad9-a423-540ed2698fd9	36	f
25995a67-97f0-56ed-f260-e1b51baa1085	d819b7d7-8f6e-42de-8d58-dfb6ce9dbcd4	35	f
25995a67-97f0-56ed-f260-e1b51baa1085	de3007dc-75a1-48a8-b958-645fbb6f1672	3	f
25995a67-97f0-56ed-f260-e1b51baa1085	e157beec-e1ed-44d6-81bd-6c83962e4dc3	37	f
25995a67-97f0-56ed-f260-e1b51baa1085	e6aca443-b57d-4d50-a967-c13d25996add	38	f
25995a67-97f0-56ed-f260-e1b51baa1085	ecf991aa-bd56-4c6e-84ea-7cb8e5763bd8	33	f
25995a67-97f0-56ed-f260-e1b51baa1085	ee509393-99c3-4a16-a611-ef14eba5bdc9	12	f
37b0a38f-e912-e763-c455-2644baf744ac	0cd6e56f-4e7c-43bb-a73b-d2ff44b9b3c2	23	f
37b0a38f-e912-e763-c455-2644baf744ac	186834c2-3c54-4557-a005-046228fb9094	6	f
37b0a38f-e912-e763-c455-2644baf744ac	186834c2-3c54-4557-a005-046228fb9094	24	f
37b0a38f-e912-e763-c455-2644baf744ac	18926068-66e9-4c54-b195-2a6fc8b55446	5	f
37b0a38f-e912-e763-c455-2644baf744ac	1f767596-ec9e-43a2-bfca-75dffdc63355	3	f
37b0a38f-e912-e763-c455-2644baf744ac	2949a9cf-7560-422e-beb3-e27e0e83a920	28	f
37b0a38f-e912-e763-c455-2644baf744ac	2949a9cf-7560-422e-beb3-e27e0e83a920	29	f
37b0a38f-e912-e763-c455-2644baf744ac	3a377408-57fd-4a20-a8a7-da6f2b3fef03	11	f
37b0a38f-e912-e763-c455-2644baf744ac	3a377408-57fd-4a20-a8a7-da6f2b3fef03	12	f
37b0a38f-e912-e763-c455-2644baf744ac	42e3f80a-fc68-45b4-b707-fd40fcf511b0	25	f
37b0a38f-e912-e763-c455-2644baf744ac	42e3f80a-fc68-45b4-b707-fd40fcf511b0	26	f
37b0a38f-e912-e763-c455-2644baf744ac	43aa094e-74d2-4ff4-9dca-4d20cede6a25	17	f
37b0a38f-e912-e763-c455-2644baf744ac	4471cb7c-e4e7-4e02-814e-ccd2b10bffd9	35	f
37b0a38f-e912-e763-c455-2644baf744ac	4471cb7c-e4e7-4e02-814e-ccd2b10bffd9	36	f
37b0a38f-e912-e763-c455-2644baf744ac	45886a9b-ab18-4739-90a0-55780dc7e3b2	9	f
37b0a38f-e912-e763-c455-2644baf744ac	45886a9b-ab18-4739-90a0-55780dc7e3b2	10	f
37b0a38f-e912-e763-c455-2644baf744ac	4bb0c695-58d5-4369-9f45-714e86e96d53	2	f
37b0a38f-e912-e763-c455-2644baf744ac	65d39ecd-061e-4d69-9f04-3e762b4f1931	13	f
37b0a38f-e912-e763-c455-2644baf744ac	65d39ecd-061e-4d69-9f04-3e762b4f1931	14	f
37b0a38f-e912-e763-c455-2644baf744ac	660325d8-04dd-4291-8e71-326cb2e5ac09	4	f
37b0a38f-e912-e763-c455-2644baf744ac	68743bc3-b732-411f-bf31-1f4df08ab9d8	8	f
37b0a38f-e912-e763-c455-2644baf744ac	6df0c398-c516-42c0-8ec8-44b80b6a7e13	20	f
37b0a38f-e912-e763-c455-2644baf744ac	6df0c398-c516-42c0-8ec8-44b80b6a7e13	21	f
37b0a38f-e912-e763-c455-2644baf744ac	75daba8e-8e91-48e6-8f29-1efb6623d34d	38	f
37b0a38f-e912-e763-c455-2644baf744ac	8211dffc-b9d3-430e-8d99-eb6816401511	30	f
37b0a38f-e912-e763-c455-2644baf744ac	8211dffc-b9d3-430e-8d99-eb6816401511	31	f
37b0a38f-e912-e763-c455-2644baf744ac	8211dffc-b9d3-430e-8d99-eb6816401511	32	f
37b0a38f-e912-e763-c455-2644baf744ac	8227c90f-5504-4f7b-a7ab-56397a0cf5e1	18	f
37b0a38f-e912-e763-c455-2644baf744ac	871f19a8-6b4c-4db5-85c2-dba7d319f5d8	40	f
37b0a38f-e912-e763-c455-2644baf744ac	9b558a9f-01ce-4e72-9bc6-b2c2d8e7c4d8	33	f
37b0a38f-e912-e763-c455-2644baf744ac	9b558a9f-01ce-4e72-9bc6-b2c2d8e7c4d8	34	f
37b0a38f-e912-e763-c455-2644baf744ac	9e15c468-b722-45e1-ab52-e857ff2a06b3	1	f
37b0a38f-e912-e763-c455-2644baf744ac	ae721416-6f82-434f-8d22-ab3e8dd6c87e	39	f
37b0a38f-e912-e763-c455-2644baf744ac	bbd0a576-665a-4500-98a6-1305cffe837c	19	f
37b0a38f-e912-e763-c455-2644baf744ac	c670ebda-5c1c-4897-8137-62289b57a723	27	f
37b0a38f-e912-e763-c455-2644baf744ac	d89a2091-bee7-4618-be33-d3818c81327f	15	f
37b0a38f-e912-e763-c455-2644baf744ac	d89a2091-bee7-4618-be33-d3818c81327f	16	f
37b0a38f-e912-e763-c455-2644baf744ac	d99ad950-5296-4285-a38c-8dfed74df0bd	22	f
37b0a38f-e912-e763-c455-2644baf744ac	ee509393-99c3-4a16-a611-ef14eba5bdc9	37	f
37b0a38f-e912-e763-c455-2644baf744ac	f51ce835-5c07-4eaf-bbe6-b7cb5c6fac2f	7	f
5413f293-5ee9-32f7-c251-42c06170970c	03082b08-4731-612d-52c3-0837ac27fe52	39	f
5413f293-5ee9-32f7-c251-42c06170970c	03765705-5e6c-4fb8-bfd0-9f022aaad97b	12	f
5413f293-5ee9-32f7-c251-42c06170970c	03765705-5e6c-4fb8-bfd0-9f022aaad97b	13	f
5413f293-5ee9-32f7-c251-42c06170970c	0764e611-45e9-4691-b478-1ca39de3534a	21	f
5413f293-5ee9-32f7-c251-42c06170970c	0764e611-45e9-4691-b478-1ca39de3534a	22	f
5413f293-5ee9-32f7-c251-42c06170970c	0a0967c7-9e13-48dc-b54a-bb5476c024a1	37	f
5413f293-5ee9-32f7-c251-42c06170970c	0a0967c7-9e13-48dc-b54a-bb5476c024a1	38	f
5413f293-5ee9-32f7-c251-42c06170970c	235c0a23-caff-488e-91f4-2d52793ed03c	20	f
5413f293-5ee9-32f7-c251-42c06170970c	251a7ad5-6f2f-42ca-a2ac-71f26e70a758	23	f
5413f293-5ee9-32f7-c251-42c06170970c	33c624b0-7bc3-43df-8838-e11eca58a33f	40	f
5413f293-5ee9-32f7-c251-42c06170970c	47d56d6b-e909-4d3b-a83f-0d36f3a68165	31	f
5413f293-5ee9-32f7-c251-42c06170970c	496d54a6-3beb-442f-b2b5-f3cc32cc61ce	35	f
5413f293-5ee9-32f7-c251-42c06170970c	496d54a6-3beb-442f-b2b5-f3cc32cc61ce	36	f
5413f293-5ee9-32f7-c251-42c06170970c	5b9db681-bf83-402b-84e3-8a162686fef3	18	f
5413f293-5ee9-32f7-c251-42c06170970c	5b9db681-bf83-402b-84e3-8a162686fef3	19	f
5413f293-5ee9-32f7-c251-42c06170970c	5f55ea55-153a-4c7e-ad93-d5c00132fe34	26	f
5413f293-5ee9-32f7-c251-42c06170970c	5f55ea55-153a-4c7e-ad93-d5c00132fe34	27	f
5413f293-5ee9-32f7-c251-42c06170970c	6a6a67e7-0e41-4501-bb80-ecf887c8ca9e	8	f
5413f293-5ee9-32f7-c251-42c06170970c	6a6a67e7-0e41-4501-bb80-ecf887c8ca9e	9	f
5413f293-5ee9-32f7-c251-42c06170970c	815dbea2-cc55-4dd2-9848-eb09e2765934	3	f
5413f293-5ee9-32f7-c251-42c06170970c	8a8ce05e-f7e9-f046-32aa-db4fddc587db	33	f
5413f293-5ee9-32f7-c251-42c06170970c	8a8ce05e-f7e9-f046-32aa-db4fddc587db	34	f
5413f293-5ee9-32f7-c251-42c06170970c	8c1be572-1fee-4bf1-8a3d-205a8c5b05a6	4	f
5413f293-5ee9-32f7-c251-42c06170970c	8c1be572-1fee-4bf1-8a3d-205a8c5b05a6	5	f
5413f293-5ee9-32f7-c251-42c06170970c	9380efb6-542a-4399-bc5e-2b5a8e8826f7	10	f
5413f293-5ee9-32f7-c251-42c06170970c	9380efb6-542a-4399-bc5e-2b5a8e8826f7	11	f
5413f293-5ee9-32f7-c251-42c06170970c	944ff964-c242-46a1-bea1-e4c212326619	29	f
5413f293-5ee9-32f7-c251-42c06170970c	944ff964-c242-46a1-bea1-e4c212326619	30	f
5413f293-5ee9-32f7-c251-42c06170970c	a7ddb739-d528-4430-a6f6-85ecbd6fd7be	32	f
5413f293-5ee9-32f7-c251-42c06170970c	b1e4abf6-db47-4604-b470-aae9a235aaf2	16	f
5413f293-5ee9-32f7-c251-42c06170970c	b1e4abf6-db47-4604-b470-aae9a235aaf2	17	f
5413f293-5ee9-32f7-c251-42c06170970c	b23481c4-04b9-4dbf-a8cb-428a7c296663	6	f
5413f293-5ee9-32f7-c251-42c06170970c	b23481c4-04b9-4dbf-a8cb-428a7c296663	7	f
5413f293-5ee9-32f7-c251-42c06170970c	be125807-81fe-4c79-9be9-7eee011e2047	24	f
5413f293-5ee9-32f7-c251-42c06170970c	be125807-81fe-4c79-9be9-7eee011e2047	25	f
5413f293-5ee9-32f7-c251-42c06170970c	c6e0153f-6ce7-494e-a1e6-48f1daf5b927	14	f
5413f293-5ee9-32f7-c251-42c06170970c	c6e0153f-6ce7-494e-a1e6-48f1daf5b927	15	f
5413f293-5ee9-32f7-c251-42c06170970c	edb2995b-d2aa-4ae1-93f3-842eeee455ac	28	f
5413f293-5ee9-32f7-c251-42c06170970c	f290116f-2e09-47e2-b42d-03db7874af7e	1	f
5413f293-5ee9-32f7-c251-42c06170970c	f290116f-2e09-47e2-b42d-03db7874af7e	2	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	091f42b0-e27e-43f8-9efa-a4f98c64567c	15	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	0a623ca1-1d49-42b3-a18d-26feafd59da1	23	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	143a0f28-6ee1-4da0-ab19-fa3da7085fab	26	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	184a0b61-8f24-4ac1-8986-b727929130a7	8	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	19bb7834-b488-4cde-a33e-fec3684c4466	11	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	1db4f266-5b6f-4e88-a9c1-122719af76fb	25	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	1db4f266-5b6f-4e88-a9c1-122719af76fb	28	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	20c9d426-ad07-4207-a37b-c5a26a0d672d	1	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	211eb1c6-bd7f-4514-8b40-85cf63408c0d	13	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	4ac368b2-ec89-455f-8a54-a4e86bf4f4f0	7	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	55221c16-bdb8-4fc8-9f70-6e40a5e9c362	30	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	55221c16-bdb8-4fc8-9f70-6e40a5e9c362	31	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	56b9734d-1fd9-479f-8083-29d75fa32055	24	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	57a5b82e-8ece-4d63-8771-96ddd6f002ad	29	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	683d5639-5fb2-4262-a433-2d690921ec5b	34	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	6b74f280-3bdb-4ca2-8747-f67be5e9e605	10	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	6beb29f5-48cb-4a9d-93a6-314154d23e52	6	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	6c4de6a4-0e0d-4a58-96ef-d9ae0ae0ff2f	3	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	6e897788-cfb4-4c3c-a812-fa0a4848f0b3	9	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	7228ef3b-1118-4eca-9ed7-3c6c7f526fb1	14	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	73b39f6f-1a38-4649-b1df-b15c6f12594f	40	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	86a9ebb9-4d7d-491d-85a9-ad19f102a951	32	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	8f2b5cf5-b2f8-40e4-a6bb-0ea839ee07c9	27	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	916c9cc8-7311-4dfc-9f7e-c0c76ce9f477	21	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	916c9cc8-7311-4dfc-9f7e-c0c76ce9f477	22	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	91a6434b-c439-4d59-b384-7691aa5b2136	33	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	91a6434b-c439-4d59-b384-7691aa5b2136	35	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	9dd03067-9d4a-427c-b815-9c115a8ea029	16	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	9dd03067-9d4a-427c-b815-9c115a8ea029	17	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	bddef5c5-1e0a-4884-af24-e27e272b2b4f	38	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	bddef5c5-1e0a-4884-af24-e27e272b2b4f	39	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	c066bcfd-cb90-488d-ab94-d54e6d3e7271	19	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	c066bcfd-cb90-488d-ab94-d54e6d3e7271	20	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	d2730724-3fa7-4341-82fb-a8b4efc16614	4	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	d3995422-83f3-4abc-b023-9cd11e903faa	18	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	d39eda70-52df-4612-bd5f-a79e86b78eb2	12	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	df57fbe5-71d3-472a-b2e9-81113fbc415e	2	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	e157beec-e1ed-44d6-81bd-6c83962e4dc3	5	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	e73ba017-aa33-414b-a64b-e8feac40ba1f	36	f
5cbfadc7-097c-888c-c657-ad2797e3c8fc	e73ba017-aa33-414b-a64b-e8feac40ba1f	37	f
80e64161-4e73-4e48-c7df-620d17849ef1	1609e63b-ea3e-ef12-95ee-c430fce78726	9	f
80e64161-4e73-4e48-c7df-620d17849ef1	1609e63b-ea3e-ef12-95ee-c430fce78726	10	f
80e64161-4e73-4e48-c7df-620d17849ef1	18536825-81ef-1a3f-a7b2-c66c10a52523	40	f
80e64161-4e73-4e48-c7df-620d17849ef1	1ec9e57b-2a39-fe2e-813e-562f7ac501f0	30	f
80e64161-4e73-4e48-c7df-620d17849ef1	29ac0a01-d149-0707-d649-9bc690d1df9d	18	f
80e64161-4e73-4e48-c7df-620d17849ef1	29ac0a01-d149-0707-d649-9bc690d1df9d	19	f
80e64161-4e73-4e48-c7df-620d17849ef1	4d93bb51-fc90-5aaf-7620-0f72f96da306	2	f
80e64161-4e73-4e48-c7df-620d17849ef1	4d93bb51-fc90-5aaf-7620-0f72f96da306	3	f
80e64161-4e73-4e48-c7df-620d17849ef1	4e4ec732-7060-4c54-1111-8d9de93a6ebc	17	f
80e64161-4e73-4e48-c7df-620d17849ef1	50018881-73b5-72ce-92c0-9455cf4b873b	35	f
80e64161-4e73-4e48-c7df-620d17849ef1	50018881-73b5-72ce-92c0-9455cf4b873b	36	f
80e64161-4e73-4e48-c7df-620d17849ef1	524d05a1-6fb5-194d-ec31-9f041a4ce29d	14	f
80e64161-4e73-4e48-c7df-620d17849ef1	524d05a1-6fb5-194d-ec31-9f041a4ce29d	27	f
80e64161-4e73-4e48-c7df-620d17849ef1	56947d0e-aed8-7957-bc8a-35cd89777ada	5	f
80e64161-4e73-4e48-c7df-620d17849ef1	56947d0e-aed8-7957-bc8a-35cd89777ada	6	f
80e64161-4e73-4e48-c7df-620d17849ef1	5fa3df14-d0c8-8ec1-976b-b827b260de4a	22	f
80e64161-4e73-4e48-c7df-620d17849ef1	71ebca0e-8f0f-c296-da3c-5cd23b006b24	38	f
80e64161-4e73-4e48-c7df-620d17849ef1	71ebca0e-8f0f-c296-da3c-5cd23b006b24	39	f
80e64161-4e73-4e48-c7df-620d17849ef1	7e52d9a4-1c3b-3f1b-5dc8-7169fb82b7ab	1	f
80e64161-4e73-4e48-c7df-620d17849ef1	7e52d9a4-1c3b-3f1b-5dc8-7169fb82b7ab	32	f
80e64161-4e73-4e48-c7df-620d17849ef1	97d36a75-45b5-d49c-539e-dceac93872ae	7	f
80e64161-4e73-4e48-c7df-620d17849ef1	97d36a75-45b5-d49c-539e-dceac93872ae	8	f
80e64161-4e73-4e48-c7df-620d17849ef1	98052819-04fa-1fee-1828-ad08588718ea	20	f
80e64161-4e73-4e48-c7df-620d17849ef1	98052819-04fa-1fee-1828-ad08588718ea	21	f
80e64161-4e73-4e48-c7df-620d17849ef1	ad746d92-5c4f-77c1-1cd2-dcede2d880f4	4	f
80e64161-4e73-4e48-c7df-620d17849ef1	ae205022-f051-8b23-a553-fd6c3a0f7067	33	f
80e64161-4e73-4e48-c7df-620d17849ef1	ae205022-f051-8b23-a553-fd6c3a0f7067	34	f
80e64161-4e73-4e48-c7df-620d17849ef1	b75a4a4a-eb49-a0ab-fa24-5a0abab25719	23	f
80e64161-4e73-4e48-c7df-620d17849ef1	b75a4a4a-eb49-a0ab-fa24-5a0abab25719	24	f
80e64161-4e73-4e48-c7df-620d17849ef1	bdd42340-8682-1677-b01d-f519cf250ee3	13	f
80e64161-4e73-4e48-c7df-620d17849ef1	bdd42340-8682-1677-b01d-f519cf250ee3	25	f
80e64161-4e73-4e48-c7df-620d17849ef1	c8c6eccd-a594-0e99-33c9-6d482e7eed8d	37	f
80e64161-4e73-4e48-c7df-620d17849ef1	d49826b4-12f6-fc29-0258-961dda1f8963	28	f
80e64161-4e73-4e48-c7df-620d17849ef1	d49826b4-12f6-fc29-0258-961dda1f8963	29	f
80e64161-4e73-4e48-c7df-620d17849ef1	dc5369c6-cce8-39a9-2435-5e8026df6745	16	f
80e64161-4e73-4e48-c7df-620d17849ef1	e89958b1-fee0-dadc-9ae6-85a381ad0f29	11	f
80e64161-4e73-4e48-c7df-620d17849ef1	e89958b1-fee0-dadc-9ae6-85a381ad0f29	12	f
80e64161-4e73-4e48-c7df-620d17849ef1	ec0915e8-7307-b576-34fd-d6cac8a82117	31	f
80e64161-4e73-4e48-c7df-620d17849ef1	f07beaf0-bfca-5d8e-16d0-06d87d163a22	15	f
80e64161-4e73-4e48-c7df-620d17849ef1	f07beaf0-bfca-5d8e-16d0-06d87d163a22	26	f
9acde64a-800d-1182-060d-62b37b0b7247	0612c379-8d7c-4ec0-ac73-0e3fca13cf85	12	f
9acde64a-800d-1182-060d-62b37b0b7247	0612c379-8d7c-4ec0-ac73-0e3fca13cf85	13	f
9acde64a-800d-1182-060d-62b37b0b7247	0dc32317-e17e-49c4-b903-5c8373c392c9	24	f
9acde64a-800d-1182-060d-62b37b0b7247	0dc32317-e17e-49c4-b903-5c8373c392c9	25	f
9acde64a-800d-1182-060d-62b37b0b7247	132e1c0f-0386-4e06-9a7c-0b1a7c061cbf	11	f
9acde64a-800d-1182-060d-62b37b0b7247	315984b2-6321-4c3e-b46a-7e6510a2001b	17	f
9acde64a-800d-1182-060d-62b37b0b7247	315984b2-6321-4c3e-b46a-7e6510a2001b	18	f
9acde64a-800d-1182-060d-62b37b0b7247	31bbfe76-12a9-4161-823f-d7fad12c77a2	23	f
9acde64a-800d-1182-060d-62b37b0b7247	35178668-42aa-42d0-8092-d81804201449	35	f
9acde64a-800d-1182-060d-62b37b0b7247	3c802983-2343-4e25-bf30-e1041b9bbcba	2	f
9acde64a-800d-1182-060d-62b37b0b7247	51c54ef4-99d9-4b84-a1f9-c5a35665a750	15	f
9acde64a-800d-1182-060d-62b37b0b7247	5811ce91-38c7-4567-a434-8514bacfa601	30	f
9acde64a-800d-1182-060d-62b37b0b7247	643302f9-f208-4706-a466-dc441838013c	37	f
9acde64a-800d-1182-060d-62b37b0b7247	643302f9-f208-4706-a466-dc441838013c	38	f
9acde64a-800d-1182-060d-62b37b0b7247	746e3527-35db-4ea6-8c26-7358fb8b9ecb	29	f
9acde64a-800d-1182-060d-62b37b0b7247	74c1ce31-9fda-4df9-8706-c4ca7a13742c	21	f
9acde64a-800d-1182-060d-62b37b0b7247	74c1ce31-9fda-4df9-8706-c4ca7a13742c	22	f
9acde64a-800d-1182-060d-62b37b0b7247	86be6c15-52ed-4867-92bc-0abc6219ec87	39	f
9acde64a-800d-1182-060d-62b37b0b7247	86be6c15-52ed-4867-92bc-0abc6219ec87	40	f
9acde64a-800d-1182-060d-62b37b0b7247	86eb2dd2-b3d9-472b-a4b6-9a52a2807468	26	f
9acde64a-800d-1182-060d-62b37b0b7247	86eb2dd2-b3d9-472b-a4b6-9a52a2807468	27	f
9acde64a-800d-1182-060d-62b37b0b7247	9b8650f5-05d2-4055-acd7-253591d25cb2	14	f
9acde64a-800d-1182-060d-62b37b0b7247	ac0b95eb-04f0-4d48-b2a8-48ab18e9c90f	16	f
9acde64a-800d-1182-060d-62b37b0b7247	b735bc4c-4be4-4fc0-8119-d775a8c1de31	5	f
9acde64a-800d-1182-060d-62b37b0b7247	b735bc4c-4be4-4fc0-8119-d775a8c1de31	6	f
9acde64a-800d-1182-060d-62b37b0b7247	bffbe245-1708-4ca0-9d47-71076468639e	3	f
9acde64a-800d-1182-060d-62b37b0b7247	bffbe245-1708-4ca0-9d47-71076468639e	4	f
9acde64a-800d-1182-060d-62b37b0b7247	cd8b183d-9c9d-4d2e-b093-ec866b7e7a44	9	f
9acde64a-800d-1182-060d-62b37b0b7247	cd8b183d-9c9d-4d2e-b093-ec866b7e7a44	10	f
9acde64a-800d-1182-060d-62b37b0b7247	cefeb98c-f664-4e47-89bb-8f2adf9a7f70	19	f
9acde64a-800d-1182-060d-62b37b0b7247	cefeb98c-f664-4e47-89bb-8f2adf9a7f70	20	f
9acde64a-800d-1182-060d-62b37b0b7247	d049c17e-0097-4bb7-980f-286de5e8d100	7	f
9acde64a-800d-1182-060d-62b37b0b7247	d049c17e-0097-4bb7-980f-286de5e8d100	8	f
9acde64a-800d-1182-060d-62b37b0b7247	dac829dc-c627-42eb-b3c8-fc576f34f5e2	36	f
9acde64a-800d-1182-060d-62b37b0b7247	eabf35b6-89d0-462c-a213-b17c04ad03ab	28	f
9acde64a-800d-1182-060d-62b37b0b7247	ede6a57c-eac8-493d-86fa-d7c8569c6e98	32	f
9acde64a-800d-1182-060d-62b37b0b7247	ee0caf1c-bacf-4a70-be2a-48de76fffdd2	31	f
9acde64a-800d-1182-060d-62b37b0b7247	f25dbeb8-e618-477d-94d5-40d9fee1bfad	1	f
9acde64a-800d-1182-060d-62b37b0b7247	f42845d5-1793-4aa7-a5e4-91d1b3ce7072	34	f
9acde64a-800d-1182-060d-62b37b0b7247	f5e3be67-ae25-4556-be2a-898001e1a1fb	33	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	00286762-cca6-42a1-a904-ff9e2fc20b3a	16	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	00286762-cca6-42a1-a904-ff9e2fc20b3a	32	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	01d41265-814d-4b9d-8856-6b9ef0f09739	23	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	01d41265-814d-4b9d-8856-6b9ef0f09739	24	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	03082b08-4731-612d-52c3-0837ac27fe52	40	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	10093d14-96b1-4e1e-a559-899f018080a0	35	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	10093d14-96b1-4e1e-a559-899f018080a0	36	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	1716abfd-b0b1-414f-84f1-82ee005928f6	33	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	1716abfd-b0b1-414f-84f1-82ee005928f6	34	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	196e641f-20be-4577-bf49-179abe0284aa	39	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	19c2c236-8e9a-4ec9-b7e2-83cf395af342	29	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	19c2c236-8e9a-4ec9-b7e2-83cf395af342	30	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	28eda665-0626-4aaf-8073-e05d22aed99f	21	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	2fa57040-8e36-4191-96ef-1f38674f62ee	27	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	2fa57040-8e36-4191-96ef-1f38674f62ee	28	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	2fe32de8-ac6d-4e9c-b959-47fc8089301b	14	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	2fe32de8-ac6d-4e9c-b959-47fc8089301b	15	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	37025e60-4377-4017-bb29-3e53fc9ab470	13	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	3ac700eb-8c26-42b3-84bd-4ef56d2bd323	22	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	3af26101-f649-49b7-9aa6-7be25e0d0ac2	18	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	46fd4dc7-669f-49aa-b746-5568cb927919	37	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	46fd4dc7-669f-49aa-b746-5568cb927919	38	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	556ae9ba-3cd6-423c-b62b-13bd82cb105b	1	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	5645073d-ce0d-40ce-91bc-5ed051a48f4f	4	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	5645073d-ce0d-40ce-91bc-5ed051a48f4f	5	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	64712999-d918-43bf-ac3a-edd7722e4341	8	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	64712999-d918-43bf-ac3a-edd7722e4341	9	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	a0f27839-45f4-4ad5-946a-e945eb2ed5ec	3	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	a1728344-ed7b-4575-bc31-9ddf4bee7778	2	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	a195e43f-cf00-46cc-b1a9-387940a82ae5	31	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	afd18c4d-f595-4e03-99ca-fbc782ce4e45	12	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	c69d3460-b4bb-4165-a095-57ff211c4f6a	10	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	c69d3460-b4bb-4165-a095-57ff211c4f6a	11	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	cbd1c873-3718-4ebf-aeba-be7c7fb09a35	19	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	cbd1c873-3718-4ebf-aeba-be7c7fb09a35	20	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	d4b5e1b4-d4ad-465a-ac1c-3196c36a5f49	25	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	d4b5e1b4-d4ad-465a-ac1c-3196c36a5f49	26	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	e5e29ff7-28e6-49b4-a37a-b09c39d9295f	6	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	e5e29ff7-28e6-49b4-a37a-b09c39d9295f	7	f
9bc7d302-8a94-2d02-239a-acca7e970aaf	ecc1b12f-ee41-4346-9ea0-4c9027bb380e	17	f
a7aed08f-51fb-72aa-e963-66d8437603fa	00cab774-035f-42d6-938f-966edd90c390	24	f
a7aed08f-51fb-72aa-e963-66d8437603fa	00cab774-035f-42d6-938f-966edd90c390	38	f
a7aed08f-51fb-72aa-e963-66d8437603fa	2d073746-6718-4c18-aa7f-e666a4d92a1c	25	f
a7aed08f-51fb-72aa-e963-66d8437603fa	2d151e22-1051-4499-aed7-1ba60dd23876	27	f
a7aed08f-51fb-72aa-e963-66d8437603fa	2d151e22-1051-4499-aed7-1ba60dd23876	28	f
a7aed08f-51fb-72aa-e963-66d8437603fa	3ac0ad44-4705-4258-9d12-6701ed7b75ed	5	f
a7aed08f-51fb-72aa-e963-66d8437603fa	3ac0ad44-4705-4258-9d12-6701ed7b75ed	6	f
a7aed08f-51fb-72aa-e963-66d8437603fa	3c9e5a67-f07f-4509-b49e-1e585c66f603	7	f
a7aed08f-51fb-72aa-e963-66d8437603fa	3c9e5a67-f07f-4509-b49e-1e585c66f603	8	f
a7aed08f-51fb-72aa-e963-66d8437603fa	5426d1e1-dde5-4842-8959-5753a47ffe73	35	f
a7aed08f-51fb-72aa-e963-66d8437603fa	55126f85-0d07-4b88-9e34-fab9877e512c	1	f
a7aed08f-51fb-72aa-e963-66d8437603fa	5ee124ac-e24b-43e1-8127-aad55140cefe	33	f
a7aed08f-51fb-72aa-e963-66d8437603fa	5ee124ac-e24b-43e1-8127-aad55140cefe	34	f
a7aed08f-51fb-72aa-e963-66d8437603fa	6112ef7f-50a8-47a6-975f-63ed606e8473	9	f
a7aed08f-51fb-72aa-e963-66d8437603fa	6112ef7f-50a8-47a6-975f-63ed606e8473	10	f
a7aed08f-51fb-72aa-e963-66d8437603fa	70f86e19-e0e8-40b5-999e-c9a4ebee91ce	39	f
a7aed08f-51fb-72aa-e963-66d8437603fa	70f86e19-e0e8-40b5-999e-c9a4ebee91ce	40	f
a7aed08f-51fb-72aa-e963-66d8437603fa	7636519c-863c-43e5-8a30-e46cb0a4201c	19	f
a7aed08f-51fb-72aa-e963-66d8437603fa	7bd1dbe1-1036-4e6d-ba52-56e6f1f65842	29	f
a7aed08f-51fb-72aa-e963-66d8437603fa	7bd1dbe1-1036-4e6d-ba52-56e6f1f65842	30	f
a7aed08f-51fb-72aa-e963-66d8437603fa	89b8def4-506f-4aab-b045-4ac70dfa6138	31	f
a7aed08f-51fb-72aa-e963-66d8437603fa	89b8def4-506f-4aab-b045-4ac70dfa6138	32	f
a7aed08f-51fb-72aa-e963-66d8437603fa	8d4b7911-4202-4c91-9f16-9d0e3c20536e	20	f
a7aed08f-51fb-72aa-e963-66d8437603fa	8d4b7911-4202-4c91-9f16-9d0e3c20536e	21	f
a7aed08f-51fb-72aa-e963-66d8437603fa	9107def3-4ea9-4e74-bf64-27d5fc72c2cf	2	f
a7aed08f-51fb-72aa-e963-66d8437603fa	948b8fd3-e7e3-4d4c-9096-70991675642f	26	f
a7aed08f-51fb-72aa-e963-66d8437603fa	9e51f995-219b-455a-97f2-2a3d11bf662a	17	f
a7aed08f-51fb-72aa-e963-66d8437603fa	9e51f995-219b-455a-97f2-2a3d11bf662a	18	f
a7aed08f-51fb-72aa-e963-66d8437603fa	b377455b-733e-401d-9a97-60da5b6c9772	15	f
a7aed08f-51fb-72aa-e963-66d8437603fa	b377455b-733e-401d-9a97-60da5b6c9772	16	f
a7aed08f-51fb-72aa-e963-66d8437603fa	bdaf3344-d51c-4c0d-85c5-3255191f020f	11	f
a7aed08f-51fb-72aa-e963-66d8437603fa	bdaf3344-d51c-4c0d-85c5-3255191f020f	12	f
a7aed08f-51fb-72aa-e963-66d8437603fa	c01a55b6-f4a3-4dfd-a8ed-297ea1ed14c3	13	f
a7aed08f-51fb-72aa-e963-66d8437603fa	c16c7d6b-f57c-4700-9c3c-53d69f9ff9c1	22	f
a7aed08f-51fb-72aa-e963-66d8437603fa	c16c7d6b-f57c-4700-9c3c-53d69f9ff9c1	23	f
a7aed08f-51fb-72aa-e963-66d8437603fa	da711ace-1ce4-49e6-9bab-29ba32152bca	36	f
a7aed08f-51fb-72aa-e963-66d8437603fa	da711ace-1ce4-49e6-9bab-29ba32152bca	37	f
a7aed08f-51fb-72aa-e963-66d8437603fa	eaa11cff-4d19-46f6-8742-a9cda948832c	3	f
a7aed08f-51fb-72aa-e963-66d8437603fa	eaa11cff-4d19-46f6-8742-a9cda948832c	4	f
a7aed08f-51fb-72aa-e963-66d8437603fa	ee992d35-e6c6-4b5f-8b03-3813caf62ef8	14	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	12cc7479-32f0-f341-2b04-13a94516466f	20	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	12cc7479-32f0-f341-2b04-13a94516466f	21	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	18f43003-491f-378c-1dc2-6daed587d8dd	31	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	18f43003-491f-378c-1dc2-6daed587d8dd	32	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	38685a02-8a09-428c-8918-493bce7e3c33	17	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	626a4f12-9991-4da8-8a5d-fa76d44cc502	16	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	642df00f-ac17-4c04-9ab5-539895f0c053	35	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	6af6e04f-5a4f-486c-bc0f-35f4aec96a1a	15	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	7601edb2-69d1-df7f-6467-2654ac3ba0a8	3	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	7601edb2-69d1-df7f-6467-2654ac3ba0a8	4	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	790e8a03-c9e1-7c54-1205-8c55f248db59	9	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	790e8a03-c9e1-7c54-1205-8c55f248db59	10	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	7dc19f6b-a2a0-d69a-5411-f1fd2768d953	22	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	7dc19f6b-a2a0-d69a-5411-f1fd2768d953	23	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	85ffaf46-d495-04bd-3b9b-fa41a911e462	12	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	85ffaf46-d495-04bd-3b9b-fa41a911e462	13	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	8ad2f612-8b70-15c9-2b56-f4484fd0a1b1	5	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	8ad2f612-8b70-15c9-2b56-f4484fd0a1b1	6	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	8cf94545-56da-4e84-aa87-8f212dab95b0	28	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	8cfd0bbc-fa3c-72eb-837c-f08faf21faae	26	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	8cfd0bbc-fa3c-72eb-837c-f08faf21faae	27	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	99e8e9c0-6ef9-4434-f28b-7dcab8802518	38	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	99e8e9c0-6ef9-4434-f28b-7dcab8802518	39	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	a072bf5d-dc70-32bf-f7e0-479c1bfe329c	24	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	a072bf5d-dc70-32bf-f7e0-479c1bfe329c	25	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	a6bfcaeb-5178-d4a1-43c4-4db5d8165f1e	18	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	a6bfcaeb-5178-d4a1-43c4-4db5d8165f1e	19	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	a93c7b37-9296-8538-2f2a-8da870125d12	33	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	a93c7b37-9296-8538-2f2a-8da870125d12	34	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	ad944788-4a61-13f4-42ad-5c7da6951d35	7	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	ad944788-4a61-13f4-42ad-5c7da6951d35	8	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	b465c176-75a7-4aca-8369-f6b2712ba706	11	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	c7ab0f6e-9fdb-4643-8043-dba35acf255e	36	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	c7ab0f6e-9fdb-4643-8043-dba35acf255e	37	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	c801c4d1-781f-3d10-bb17-f1aba459ce80	1	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	c801c4d1-781f-3d10-bb17-f1aba459ce80	2	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	ca467fb5-afe2-4a9a-8736-af21c72c7620	14	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	cd7120e4-9f69-48d1-9048-ed625e5e6a00	40	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	de3028bd-0067-636a-c2c9-af5095da96c9	29	f
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	de3028bd-0067-636a-c2c9-af5095da96c9	30	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	03082b08-4731-612d-52c3-0837ac27fe52	32	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	30	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	31	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	12a58dc9-dcc6-4b2e-85dc-e7231837019c	4	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	12a58dc9-dcc6-4b2e-85dc-e7231837019c	5	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	1399b830-2a53-4910-a328-97da938c229e	14	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	1399b830-2a53-4910-a328-97da938c229e	15	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	15d3a16b-40e0-4fdb-8782-1a633f9f6411	10	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	15d3a16b-40e0-4fdb-8782-1a633f9f6411	11	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	1b8a452b-2a5f-48dd-ab15-8bfa0559a8df	36	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	1b8a452b-2a5f-48dd-ab15-8bfa0559a8df	37	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	3b528d96-b951-fde0-7c6b-d50d7c7095e6	26	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	3b528d96-b951-fde0-7c6b-d50d7c7095e6	27	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	3d48417c-a22b-4c3c-98ea-79d77f977eb1	23	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	3d48417c-a22b-4c3c-98ea-79d77f977eb1	24	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	3ea5e72a-5a0e-429e-ab82-51bdfbe72ef0	25	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	3ea5e72a-5a0e-429e-ab82-51bdfbe72ef0	40	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	4ad8fa44-8f54-42bf-892c-bc1e3a4104b4	33	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	4ad8fa44-8f54-42bf-892c-bc1e3a4104b4	34	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	4f50de13-3714-43be-8bf4-65cffa582670	1	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	4f50de13-3714-43be-8bf4-65cffa582670	2	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	65307864-1cdf-4559-b8a2-b40bc44d1b58	19	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	89c28960-52c7-9002-5ca5-5ea59c6c3cdf	28	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	89c28960-52c7-9002-5ca5-5ea59c6c3cdf	29	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	8d093f6d-0ae9-43a5-83c7-8977abb052c5	6	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	8d093f6d-0ae9-43a5-83c7-8977abb052c5	7	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	8da809af-54dd-4191-ac24-3ffc4d3cbc14	17	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	8da809af-54dd-4191-ac24-3ffc4d3cbc14	18	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	93bbdffb-903a-47e6-8c13-a5f8473fb19b	38	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	93bbdffb-903a-47e6-8c13-a5f8473fb19b	39	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	ac940e2b-1aec-40c6-9e52-a4f968e7b465	16	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	c41d1804-b5fb-4ac1-af0b-31ad034f1ecc	35	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	d8d3e7b6-1d4b-4c86-8e5d-bc0ffb5f4c5d	3	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	dbf7b725-76bc-45ee-9dfc-24c4f33eddcf	20	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	dbf7b725-76bc-45ee-9dfc-24c4f33eddcf	21	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	e9d7a323-2500-4c01-881f-ceff63f34da7	12	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	e9d7a323-2500-4c01-881f-ceff63f34da7	13	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	f2cbe886-d826-48b0-9013-b0052f3abf63	8	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	f2cbe886-d826-48b0-9013-b0052f3abf63	9	f
c3ea6a27-9a85-6af3-9a45-28e000edfed0	fe01b3be-7b88-4caf-80ce-3e4f111cee6b	22	f
c4d753ed-97b9-9786-44a7-915f4971cf93	03082b08-4731-612d-52c3-0837ac27fe52	37	f
c4d753ed-97b9-9786-44a7-915f4971cf93	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	38	f
c4d753ed-97b9-9786-44a7-915f4971cf93	155186bc-e508-4562-a18f-216be9796752	17	f
c4d753ed-97b9-9786-44a7-915f4971cf93	155186bc-e508-4562-a18f-216be9796752	32	f
c4d753ed-97b9-9786-44a7-915f4971cf93	1663ae32-8957-4c03-b9b7-df5a5d443500	22	f
c4d753ed-97b9-9786-44a7-915f4971cf93	1663ae32-8957-4c03-b9b7-df5a5d443500	23	f
c4d753ed-97b9-9786-44a7-915f4971cf93	192b3884-2643-4185-bea7-2b59ff423295	35	f
c4d753ed-97b9-9786-44a7-915f4971cf93	192b3884-2643-4185-bea7-2b59ff423295	36	f
c4d753ed-97b9-9786-44a7-915f4971cf93	2ffb81ee-0b37-40ca-a114-99ce544d6a8f	10	f
c4d753ed-97b9-9786-44a7-915f4971cf93	2ffb81ee-0b37-40ca-a114-99ce544d6a8f	11	f
c4d753ed-97b9-9786-44a7-915f4971cf93	4bfb81ec-b14b-400c-b1ab-c08794ef71d3	9	f
c4d753ed-97b9-9786-44a7-915f4971cf93	4bfb81ec-b14b-400c-b1ab-c08794ef71d3	24	f
c4d753ed-97b9-9786-44a7-915f4971cf93	4edd78fc-8bb7-4767-894f-0c3d06a6ba67	3	f
c4d753ed-97b9-9786-44a7-915f4971cf93	4edd78fc-8bb7-4767-894f-0c3d06a6ba67	4	f
c4d753ed-97b9-9786-44a7-915f4971cf93	611bfcbc-eb9a-4d8c-9c22-788ccdb918c9	39	f
c4d753ed-97b9-9786-44a7-915f4971cf93	611bfcbc-eb9a-4d8c-9c22-788ccdb918c9	40	f
c4d753ed-97b9-9786-44a7-915f4971cf93	6ea959ef-c4cb-4b3d-91d0-aac96ed8b5fc	5	f
c4d753ed-97b9-9786-44a7-915f4971cf93	737bb0ac-ebac-49d1-aa56-cec823f30425	33	f
c4d753ed-97b9-9786-44a7-915f4971cf93	737bb0ac-ebac-49d1-aa56-cec823f30425	34	f
c4d753ed-97b9-9786-44a7-915f4971cf93	782b1508-c30f-4b63-b4b5-aca878c94ec5	1	f
c4d753ed-97b9-9786-44a7-915f4971cf93	782b1508-c30f-4b63-b4b5-aca878c94ec5	16	f
c4d753ed-97b9-9786-44a7-915f4971cf93	8d5dd2e5-2a74-4794-b63b-9bcc4a59b940	2	f
c4d753ed-97b9-9786-44a7-915f4971cf93	90cbf716-9b68-444a-9b72-e698e80689da	26	f
c4d753ed-97b9-9786-44a7-915f4971cf93	90cbf716-9b68-444a-9b72-e698e80689da	27	f
c4d753ed-97b9-9786-44a7-915f4971cf93	afd4e817-701c-41ae-86cb-c2216f044d9e	7	f
c4d753ed-97b9-9786-44a7-915f4971cf93	afd4e817-701c-41ae-86cb-c2216f044d9e	8	f
c4d753ed-97b9-9786-44a7-915f4971cf93	c198d6a0-9c43-49c1-83ab-430ecac4a939	18	f
c4d753ed-97b9-9786-44a7-915f4971cf93	c51317ee-c6ac-4b42-a3d9-44588592e315	6	f
c4d753ed-97b9-9786-44a7-915f4971cf93	c838729a-e9e2-4f16-bc4f-aa0d01f06cda	28	f
c4d753ed-97b9-9786-44a7-915f4971cf93	c838729a-e9e2-4f16-bc4f-aa0d01f06cda	29	f
c4d753ed-97b9-9786-44a7-915f4971cf93	d3453e07-908b-43c1-a169-65a04f4ba779	14	f
c4d753ed-97b9-9786-44a7-915f4971cf93	d3453e07-908b-43c1-a169-65a04f4ba779	15	f
c4d753ed-97b9-9786-44a7-915f4971cf93	d7a51d26-a7d0-402f-a5a3-4df6a83dd96a	19	f
c4d753ed-97b9-9786-44a7-915f4971cf93	ddafd5c3-4e1b-45c5-b471-875cde169fc3	25	f
c4d753ed-97b9-9786-44a7-915f4971cf93	dfa50411-7342-4e4e-ba02-f01fcd07597f	20	f
c4d753ed-97b9-9786-44a7-915f4971cf93	dfa50411-7342-4e4e-ba02-f01fcd07597f	21	f
c4d753ed-97b9-9786-44a7-915f4971cf93	ee3a33d6-cfbd-4922-a94f-5bbe6721ddf2	30	f
c4d753ed-97b9-9786-44a7-915f4971cf93	ee3a33d6-cfbd-4922-a94f-5bbe6721ddf2	31	f
c4d753ed-97b9-9786-44a7-915f4971cf93	ef93e0c1-7333-47fc-a77a-d5d28972054c	12	f
c4d753ed-97b9-9786-44a7-915f4971cf93	ef93e0c1-7333-47fc-a77a-d5d28972054c	13	f
c618cbbd-3251-06a0-f173-4d973d9a3717	02ebf806-906c-49a6-8fef-7881087ce1c3	26	f
c618cbbd-3251-06a0-f173-4d973d9a3717	02ebf806-906c-49a6-8fef-7881087ce1c3	27	f
c618cbbd-3251-06a0-f173-4d973d9a3717	0d558d38-931d-49e4-a745-a5421139d762	24	f
c618cbbd-3251-06a0-f173-4d973d9a3717	14808116-18a1-4c69-8fa6-cc4c913bea1e	23	f
c618cbbd-3251-06a0-f173-4d973d9a3717	1b7ae872-9779-4c5b-9521-a148f378f0e3	10	f
c618cbbd-3251-06a0-f173-4d973d9a3717	1b7ae872-9779-4c5b-9521-a148f378f0e3	11	f
c618cbbd-3251-06a0-f173-4d973d9a3717	30fd927e-b6f7-40e8-9cd0-794a9c0777c9	28	f
c618cbbd-3251-06a0-f173-4d973d9a3717	30fd927e-b6f7-40e8-9cd0-794a9c0777c9	29	f
c618cbbd-3251-06a0-f173-4d973d9a3717	331cfe79-50f3-4d7a-b985-3d1bd4d21711	2	f
c618cbbd-3251-06a0-f173-4d973d9a3717	4cec5560-04d0-45ea-93df-f70aa172c5f1	18	f
c618cbbd-3251-06a0-f173-4d973d9a3717	4cec5560-04d0-45ea-93df-f70aa172c5f1	19	f
c618cbbd-3251-06a0-f173-4d973d9a3717	4cf69a10-c61c-49c2-ac09-885cb8dab41c	20	f
c618cbbd-3251-06a0-f173-4d973d9a3717	4cf69a10-c61c-49c2-ac09-885cb8dab41c	21	f
c618cbbd-3251-06a0-f173-4d973d9a3717	5118435f-a645-480b-b8e5-b081fb37120e	22	f
c618cbbd-3251-06a0-f173-4d973d9a3717	54adf4a3-f1c0-4d03-9d11-cdbecc1e971b	36	f
c618cbbd-3251-06a0-f173-4d973d9a3717	54adf4a3-f1c0-4d03-9d11-cdbecc1e971b	37	f
c618cbbd-3251-06a0-f173-4d973d9a3717	55bfe759-5ab3-4df2-ab4f-d7b4791b03a0	40	f
c618cbbd-3251-06a0-f173-4d973d9a3717	660470c8-190b-4a91-aef5-e68161f3abeb	9	f
c618cbbd-3251-06a0-f173-4d973d9a3717	694c2fd5-0cfa-4a0d-a4a0-73a213345a2b	15	f
c618cbbd-3251-06a0-f173-4d973d9a3717	6b358d08-ac3a-4675-ae72-d60d6238f457	7	f
c618cbbd-3251-06a0-f173-4d973d9a3717	6b358d08-ac3a-4675-ae72-d60d6238f457	8	f
c618cbbd-3251-06a0-f173-4d973d9a3717	8058eb47-e5b6-4c8a-bb62-bc5b3ca5e027	1	f
c618cbbd-3251-06a0-f173-4d973d9a3717	8058eb47-e5b6-4c8a-bb62-bc5b3ca5e027	6	f
c618cbbd-3251-06a0-f173-4d973d9a3717	87d393d3-3269-4b47-ab9c-b3a0df46bba2	3	f
c618cbbd-3251-06a0-f173-4d973d9a3717	97a13c55-f654-49df-a7a9-0ad57fc4be50	16	f
c618cbbd-3251-06a0-f173-4d973d9a3717	97a13c55-f654-49df-a7a9-0ad57fc4be50	17	f
c618cbbd-3251-06a0-f173-4d973d9a3717	a0287a96-2d70-4208-bde7-d168c527ee0e	34	f
c618cbbd-3251-06a0-f173-4d973d9a3717	a0287a96-2d70-4208-bde7-d168c527ee0e	35	f
c618cbbd-3251-06a0-f173-4d973d9a3717	b196dd4c-b1ef-4686-b86c-875bdb561c14	12	f
c618cbbd-3251-06a0-f173-4d973d9a3717	b196dd4c-b1ef-4686-b86c-875bdb561c14	13	f
c618cbbd-3251-06a0-f173-4d973d9a3717	c662fa55-8df0-4f95-ac29-80d560ba7b29	38	f
c618cbbd-3251-06a0-f173-4d973d9a3717	c662fa55-8df0-4f95-ac29-80d560ba7b29	39	f
c618cbbd-3251-06a0-f173-4d973d9a3717	cc2f7221-7a5d-47e2-87ae-e4931ca9c31d	4	f
c618cbbd-3251-06a0-f173-4d973d9a3717	cc2f7221-7a5d-47e2-87ae-e4931ca9c31d	5	f
c618cbbd-3251-06a0-f173-4d973d9a3717	d8408690-b25b-4ae0-9097-fe2840e778f2	32	f
c618cbbd-3251-06a0-f173-4d973d9a3717	d8408690-b25b-4ae0-9097-fe2840e778f2	33	f
c618cbbd-3251-06a0-f173-4d973d9a3717	da78a028-7c5f-4118-ae1c-0af388512d09	25	f
c618cbbd-3251-06a0-f173-4d973d9a3717	dafe14f2-d6ef-4d91-9da5-79e0286fa195	14	f
c618cbbd-3251-06a0-f173-4d973d9a3717	f04044ed-e05c-470c-8186-08167d3ab96a	30	f
c618cbbd-3251-06a0-f173-4d973d9a3717	f04044ed-e05c-470c-8186-08167d3ab96a	31	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	03082b08-4731-612d-52c3-0837ac27fe52	37	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	03082b08-4731-612d-52c3-0837ac27fe52	38	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	0814a527-e3f0-481e-991c-6e1ec6a562ab	31	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	0d85f09f-1e0d-c402-08cf-63e7a3aa73f3	1	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	0d85f09f-1e0d-c402-08cf-63e7a3aa73f3	2	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	0d85f09f-1e0d-c402-08cf-63e7a3aa73f3	11	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	36	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	1bf7dd87-3e2e-4901-a991-69e353d62d70	12	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	1e3e2aac-f1eb-b0e9-cdcf-bd1b6948834b	22	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	21df0e5f-d10a-4bee-9292-c895ff975d93	15	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	21df0e5f-d10a-4bee-9292-c895ff975d93	16	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	24cfe0c8-eab4-8e69-cc95-621af614e353	34	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	24cfe0c8-eab4-8e69-cc95-621af614e353	35	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	3b528d96-b951-fde0-7c6b-d50d7c7095e6	29	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	3b528d96-b951-fde0-7c6b-d50d7c7095e6	30	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	436d901e-4646-ad9d-de1c-345bef37cbb5	3	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	436d901e-4646-ad9d-de1c-345bef37cbb5	4	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	626c5745-d091-45cd-a8ed-b68c0cab5ce7	23	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	69fd5f11-7ca5-17b4-4938-cab72a2288fa	39	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	69fd5f11-7ca5-17b4-4938-cab72a2288fa	40	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	728cc8a6-1a2f-4f90-9932-8aefbff75847	19	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	728cc8a6-1a2f-4f90-9932-8aefbff75847	20	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	7e52d9a4-1c3b-3f1b-5dc8-7169fb82b7ab	14	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	89c28960-52c7-9002-5ca5-5ea59c6c3cdf	32	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	89c28960-52c7-9002-5ca5-5ea59c6c3cdf	33	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	8a8ce05e-f7e9-f046-32aa-db4fddc587db	27	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	8a8ce05e-f7e9-f046-32aa-db4fddc587db	28	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	962ef500-7ff4-4835-9bd3-260fb0fbd972	21	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	9e685460-a6d3-49e3-9fe7-f7a0e4f39d5f	25	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	a2eac635-5748-3650-f2e3-bc108c8198f3	5	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	a2eac635-5748-3650-f2e3-bc108c8198f3	6	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	a5d7756c-ef3c-8237-dbf6-b96d7aaf6ebf	24	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	c261ef94-6821-ddef-0f8f-d46fbbe43ac3	13	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	d467b1d2-2d3e-9c1d-4e64-5a20a178a93f	7	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	d467b1d2-2d3e-9c1d-4e64-5a20a178a93f	8	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	e408acdf-7b80-71f8-cd11-9f79c9d6a4d7	26	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	e5971cbd-000e-41cf-90dc-c761f4c1ad20	9	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	f1433fba-dec6-3e5b-4ac2-ac5b54a97cf8	18	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	f325dcba-3df3-45d4-b4ab-0034e3a496af	17	f
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	fb1b8c0b-fa19-a6aa-4a79-d3119961d94b	10	f
e91add05-a163-a2ed-9e59-14cdde37e147	03082b08-4731-612d-52c3-0837ac27fe52	8	f
e91add05-a163-a2ed-9e59-14cdde37e147	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	6	f
e91add05-a163-a2ed-9e59-14cdde37e147	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	7	f
e91add05-a163-a2ed-9e59-14cdde37e147	1cfc52a9-c7a7-4cd8-9847-3cfe8069a012	18	f
e91add05-a163-a2ed-9e59-14cdde37e147	1f2150d0-d86c-4a51-9b53-c32797a15e8d	30	f
e91add05-a163-a2ed-9e59-14cdde37e147	1f2150d0-d86c-4a51-9b53-c32797a15e8d	31	f
e91add05-a163-a2ed-9e59-14cdde37e147	2b2f3937-b9da-406a-be35-ec001e1c607e	22	f
e91add05-a163-a2ed-9e59-14cdde37e147	2b2f3937-b9da-406a-be35-ec001e1c607e	23	f
e91add05-a163-a2ed-9e59-14cdde37e147	2bb706a3-9791-45f8-a367-6225705d8085	4	f
e91add05-a163-a2ed-9e59-14cdde37e147	2bb706a3-9791-45f8-a367-6225705d8085	5	f
e91add05-a163-a2ed-9e59-14cdde37e147	3f060748-f1c0-4731-9c8f-9949546e7093	9	f
e91add05-a163-a2ed-9e59-14cdde37e147	3f060748-f1c0-4731-9c8f-9949546e7093	10	f
e91add05-a163-a2ed-9e59-14cdde37e147	80a3b161-1d64-4b2e-be87-ae6656013d51	13	f
e91add05-a163-a2ed-9e59-14cdde37e147	8d77f0a7-515d-4d69-9870-e1ae3c17337d	27	f
e91add05-a163-a2ed-9e59-14cdde37e147	8d77f0a7-515d-4d69-9870-e1ae3c17337d	28	f
e91add05-a163-a2ed-9e59-14cdde37e147	96d8f3cb-4bb4-4226-a30a-a81198d38d4b	20	f
e91add05-a163-a2ed-9e59-14cdde37e147	96d8f3cb-4bb4-4226-a30a-a81198d38d4b	21	f
e91add05-a163-a2ed-9e59-14cdde37e147	9f32a7db-1fd9-4773-beae-c7b8c133bacc	11	f
e91add05-a163-a2ed-9e59-14cdde37e147	a688bda0-a3af-46d0-82c4-89b02b3ccf42	29	f
e91add05-a163-a2ed-9e59-14cdde37e147	ac40138d-3827-4e24-b84d-2fbcb1412c08	14	f
e91add05-a163-a2ed-9e59-14cdde37e147	ac40138d-3827-4e24-b84d-2fbcb1412c08	15	f
e91add05-a163-a2ed-9e59-14cdde37e147	ac40138d-3827-4e24-b84d-2fbcb1412c08	16	f
e91add05-a163-a2ed-9e59-14cdde37e147	b892b2b6-c971-4042-a758-92ed9296f38a	36	f
e91add05-a163-a2ed-9e59-14cdde37e147	b892b2b6-c971-4042-a758-92ed9296f38a	37	f
e91add05-a163-a2ed-9e59-14cdde37e147	b9de05b8-6f96-4c27-a9fe-a15ba6c6654c	2	f
e91add05-a163-a2ed-9e59-14cdde37e147	b9de05b8-6f96-4c27-a9fe-a15ba6c6654c	3	f
e91add05-a163-a2ed-9e59-14cdde37e147	bc31030c-fb94-454b-a228-27e2da9384db	19	f
e91add05-a163-a2ed-9e59-14cdde37e147	bd8d8986-054d-41e6-9b27-b0449e92f84e	1	f
e91add05-a163-a2ed-9e59-14cdde37e147	be0c8d5d-4d0c-4eed-af30-8847d3cea766	38	f
e91add05-a163-a2ed-9e59-14cdde37e147	c46d6947-0e5c-4813-86b4-9cfd94726cba	17	f
e91add05-a163-a2ed-9e59-14cdde37e147	c46d6947-0e5c-4813-86b4-9cfd94726cba	32	f
e91add05-a163-a2ed-9e59-14cdde37e147	ce410124-147c-4276-9057-d9b93d96a5b7	34	f
e91add05-a163-a2ed-9e59-14cdde37e147	d1c588e5-ee46-42ed-86cf-558355c76ae0	39	f
e91add05-a163-a2ed-9e59-14cdde37e147	d1c588e5-ee46-42ed-86cf-558355c76ae0	40	f
e91add05-a163-a2ed-9e59-14cdde37e147	d2fd6ffa-ab9e-4506-bf09-80eb38e42106	35	f
e91add05-a163-a2ed-9e59-14cdde37e147	d43571d6-808b-4bd2-84f9-f77666c43bde	33	f
e91add05-a163-a2ed-9e59-14cdde37e147	e82b5601-8cef-41ca-ae3b-cc3fc07745e5	12	f
e91add05-a163-a2ed-9e59-14cdde37e147	e82b5601-8cef-41ca-ae3b-cc3fc07745e5	24	f
e91add05-a163-a2ed-9e59-14cdde37e147	fbe45134-a0a0-43f8-92df-1b4fc2a23dab	25	f
e91add05-a163-a2ed-9e59-14cdde37e147	fbe45134-a0a0-43f8-92df-1b4fc2a23dab	26	f
f3b9d46c-e56c-2206-ff51-586326d731bb	02dd3f6e-956a-e2b8-a8d0-8520a39563a2	32	f
f3b9d46c-e56c-2206-ff51-586326d731bb	03082b08-4731-612d-52c3-0837ac27fe52	37	f
f3b9d46c-e56c-2206-ff51-586326d731bb	03082b08-4731-612d-52c3-0837ac27fe52	38	f
f3b9d46c-e56c-2206-ff51-586326d731bb	1213a4cd-2cc5-7a6f-18c1-cda7d2bf36c3	36	f
f3b9d46c-e56c-2206-ff51-586326d731bb	24cfe0c8-eab4-8e69-cc95-621af614e353	34	f
f3b9d46c-e56c-2206-ff51-586326d731bb	24cfe0c8-eab4-8e69-cc95-621af614e353	35	f
f3b9d46c-e56c-2206-ff51-586326d731bb	3986cfe7-f862-4e18-a762-af7e6b6f999e	19	f
f3b9d46c-e56c-2206-ff51-586326d731bb	3986cfe7-f862-4e18-a762-af7e6b6f999e	20	f
f3b9d46c-e56c-2206-ff51-586326d731bb	3b528d96-b951-fde0-7c6b-d50d7c7095e6	28	f
f3b9d46c-e56c-2206-ff51-586326d731bb	497f133a-cc05-4e3c-aede-e3eb9d43906c	18	f
f3b9d46c-e56c-2206-ff51-586326d731bb	5c546e85-3670-f1e9-6297-16cf232524b6	23	f
f3b9d46c-e56c-2206-ff51-586326d731bb	5c546e85-3670-f1e9-6297-16cf232524b6	24	f
f3b9d46c-e56c-2206-ff51-586326d731bb	60f6209b-6dcd-df3a-e2dc-8a6a32364c3d	16	f
f3b9d46c-e56c-2206-ff51-586326d731bb	60f6209b-6dcd-df3a-e2dc-8a6a32364c3d	17	f
f3b9d46c-e56c-2206-ff51-586326d731bb	611c77a9-de38-55dc-0da6-9639c0250dd3	5	f
f3b9d46c-e56c-2206-ff51-586326d731bb	611c77a9-de38-55dc-0da6-9639c0250dd3	6	f
f3b9d46c-e56c-2206-ff51-586326d731bb	617d9d34-1570-4ccc-e3dd-2f955b38b6fa	27	f
f3b9d46c-e56c-2206-ff51-586326d731bb	62a799f9-2f09-c225-c938-53ce2dc7cfc5	21	f
f3b9d46c-e56c-2206-ff51-586326d731bb	62a799f9-2f09-c225-c938-53ce2dc7cfc5	22	f
f3b9d46c-e56c-2206-ff51-586326d731bb	6962e552-e9ef-1030-7569-8d389fa5da7f	13	f
f3b9d46c-e56c-2206-ff51-586326d731bb	6962e552-e9ef-1030-7569-8d389fa5da7f	14	f
f3b9d46c-e56c-2206-ff51-586326d731bb	6962e552-e9ef-1030-7569-8d389fa5da7f	15	f
f3b9d46c-e56c-2206-ff51-586326d731bb	69fd5f11-7ca5-17b4-4938-cab72a2288fa	39	f
f3b9d46c-e56c-2206-ff51-586326d731bb	69fd5f11-7ca5-17b4-4938-cab72a2288fa	40	f
f3b9d46c-e56c-2206-ff51-586326d731bb	744cc7ff-d56b-1239-f238-6a3efdff08d1	9	f
f3b9d46c-e56c-2206-ff51-586326d731bb	744cc7ff-d56b-1239-f238-6a3efdff08d1	10	f
f3b9d46c-e56c-2206-ff51-586326d731bb	7dbcb8ec-dbb0-498b-b6ea-16cfec3e8f61	26	f
f3b9d46c-e56c-2206-ff51-586326d731bb	8488324a-06b3-ab47-5c48-bba808d20427	1	f
f3b9d46c-e56c-2206-ff51-586326d731bb	8488324a-06b3-ab47-5c48-bba808d20427	2	f
f3b9d46c-e56c-2206-ff51-586326d731bb	89c28960-52c7-9002-5ca5-5ea59c6c3cdf	33	f
f3b9d46c-e56c-2206-ff51-586326d731bb	8a2ee4cd-8437-37bc-9f20-ccf9388b6fbc	8	f
f3b9d46c-e56c-2206-ff51-586326d731bb	973995ae-435c-beb5-f300-547e7abc6b86	11	f
f3b9d46c-e56c-2206-ff51-586326d731bb	973995ae-435c-beb5-f300-547e7abc6b86	12	f
f3b9d46c-e56c-2206-ff51-586326d731bb	9c07e203-5132-490d-9a28-99715f146c8b	3	f
f3b9d46c-e56c-2206-ff51-586326d731bb	9c07e203-5132-490d-9a28-99715f146c8b	4	f
f3b9d46c-e56c-2206-ff51-586326d731bb	a8ddbfe3-a721-42c1-b26e-b762c76d9978	31	f
f3b9d46c-e56c-2206-ff51-586326d731bb	bc73916f-aefe-42e1-bfa5-23497f11fc07	30	f
f3b9d46c-e56c-2206-ff51-586326d731bb	c83a9cb6-430c-c5d9-3b80-1bb3b26d5d04	29	f
f3b9d46c-e56c-2206-ff51-586326d731bb	d3a97f75-1a6b-d532-1682-202fc3f63274	25	f
f3b9d46c-e56c-2206-ff51-586326d731bb	f7a97331-86d8-47f3-89cc-092e6e91d6f1	7	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	091f42b0-e27e-43f8-9efa-a4f98c64567c	16	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	091f42b0-e27e-43f8-9efa-a4f98c64567c	17	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	0a623ca1-1d49-42b3-a18d-26feafd59da1	21	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	0a623ca1-1d49-42b3-a18d-26feafd59da1	22	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	0c1e3fa7-8634-4a70-a97f-e2fc5c84bf8c	6	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	0d22812a-1ff3-4fbd-8364-76ab7c5049f3	13	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	0e6a2530-245b-423f-a62b-54b63e17fbe3	26	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	136f3e07-e8ec-49dd-8759-b4c8eee8317a	35	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	1b8510d7-a8af-4570-b22c-4b6f40bd577f	1	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	211eb1c6-bd7f-4514-8b40-85cf63408c0d	15	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	2235fc0b-6c63-4d75-8aa0-d886f332f8d9	30	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	2235fc0b-6c63-4d75-8aa0-d886f332f8d9	31	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	2bebdc5d-e74c-43f3-9e60-54f43ecc4000	10	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	2c5bd0ce-b966-4e47-88a9-5745f38f7053	12	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	4ac368b2-ec89-455f-8a54-a4e86bf4f4f0	5	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	53cb2d21-cbce-4e09-83da-14ff862891dd	8	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	546d7f4c-8ab9-4113-9f2c-be73f81b1f99	9	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	5f24662c-4f35-43e4-893b-b0e107c459dc	39	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	5f24662c-4f35-43e4-893b-b0e107c459dc	40	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	5f65e291-035d-485d-9415-dde0c9fefdc4	14	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	7a3849ec-3514-411c-b3ea-8290b6297880	33	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	7e469d11-e743-4f4d-a468-82c8268766db	28	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	7e469d11-e743-4f4d-a468-82c8268766db	29	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	8722f9d6-8f1b-44ad-98a2-bf9638ed25c3	24	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	87e67325-37c0-4a58-86bd-16d3a47847bd	11	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	8ea494a7-0bdf-4686-8464-948f263eaab5	34	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	8ea494a7-0bdf-4686-8464-948f263eaab5	36	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	916c9cc8-7311-4dfc-9f7e-c0c76ce9f477	23	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	9acf6ca7-1b42-492d-811e-e0e090a9156b	37	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	9c6c4e76-d2ce-4800-80ef-a63e1ee79e20	7	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	9e15c468-b722-45e1-ab52-e857ff2a06b3	4	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	b0c57480-a382-43fa-aa27-6b81a3620bd0	32	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	b813f8a1-8306-4ffe-b410-b629bc167da9	3	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	c066bcfd-cb90-488d-ab94-d54e6d3e7271	19	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	c066bcfd-cb90-488d-ab94-d54e6d3e7271	20	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	c38fe28d-0479-4c30-b54a-70b9694691fb	38	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	d3995422-83f3-4abc-b023-9cd11e903faa	18	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	ea4e7b5c-211c-437c-a8f1-236ec0858cc1	2	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	f1860cc1-713f-4f89-b480-e4473beaf327	25	f
f86b0c9e-e55e-5c31-de9c-966400de64c2	f1860cc1-713f-4f89-b480-e4473beaf327	27	f
\.


--
-- Data for Name: preset_decks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.preset_decks (id, slug, name, hero_slug, mode, landscapes, description, is_active, sort_order, created_at, winrate) FROM stdin;
252f010d-2203-546d-7f91-43d5722fdc64	tree_trunks	Tree Trunks	tree_trunks	standard	["nice"]	Готовая колода героя Tree Trunks — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
25995a67-97f0-56ed-f260-e1b51baa1085	jake2v2	Jake 2v2	jake2v2	doubles	["corn"]	Готовая колода героя Jake 2v2 — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
37b0a38f-e912-e763-c455-2644baf744ac	charlie	Charlie	charlie	doubles	["blue"]	Готовая колода героя Charlie — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
5413f293-5ee9-32f7-c251-42c06170970c	iceking	Ice King	iceking	standard	["ice"]	Готовая колода героя Ice King — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
5cbfadc7-097c-888c-c657-ad2797e3c8fc	grandprix	Grand Prix	grandprix	doubles	["sand"]	Готовая колода героя Grand Prix — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
80e64161-4e73-4e48-c7df-620d17849ef1	fiona	Fionna	fiona	standard	["rainbow"]	Готовая колода героя Fionna — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
9acde64a-800d-1182-060d-62b37b0b7247	lemongrab	Lemongrab	lemongrab	standard	["corn"]	Готовая колода героя Lemongrab — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
9bc7d302-8a94-2d02-239a-acca7e970aaf	lsp	Lumpy Space Princess	lsp	standard	["swamp"]	Готовая колода героя Lumpy Space Princess — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
a7aed08f-51fb-72aa-e963-66d8437603fa	marceline	Marceline	marceline	standard	["swamp"]	Готовая колода героя Marceline — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
bfe5b7bf-a697-1437-fdc3-4b4a25e17340	cake	Cake	cake	standard	["rainbow"]	Готовая колода героя Cake — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
c3ea6a27-9a85-6af3-9a45-28e000edfed0	ladyrainicorn	Lady Rainicorn	ladyrainicorn	standard	["sand"]	Готовая колода героя Lady Rainicorn — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
c4d753ed-97b9-9786-44a7-915f4971cf93	bubblegum	Princess Bubblegum	bubblegum	standard	["nice"]	Готовая колода героя Princess Bubblegum — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
c618cbbd-3251-06a0-f173-4d973d9a3717	gunter	Gunter	gunter	standard	["ice"]	Готовая колода героя Gunter — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
d485bfd2-5cd0-aba9-d3f0-c0cd22bd887c	lich	Lich	lich	standard	["swamp"]	Готовая колода героя Lich — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
dac464a8-e3d6-2bd1-30cc-9f0d585b4bbd	finn	Finn	finn	standard	["corn"]	Готовая колода героя Finn — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
e91add05-a163-a2ed-9e59-14cdde37e147	bmo	BMO	bmo	standard	["swamp"]	Готовая колода героя BMO — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
f3b9d46c-e56c-2206-ff51-586326d731bb	jake	Jake	jake	standard	["corn"]	Готовая колода героя Jake — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
f86b0c9e-e55e-5c31-de9c-966400de64c2	monika	Moniker	monika	doubles	["swamp"]	Готовая колода героя Moniker — сбалансированный набор из 40 карт и 4 земель для быстрого старта.	t	0	2026-08-11 13:57:08.058427+00	52.00
\.


--
-- Name: Heroes Heroes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Heroes"
    ADD CONSTRAINT "Heroes_pkey" PRIMARY KEY (hero_number);


--
-- Name: card_art card_art_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_art
    ADD CONSTRAINT card_art_pkey PRIMARY KEY (id);


--
-- Name: cards cards_card_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_card_number_key UNIQUE (card_number);


--
-- Name: cards cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);


--
-- Name: deck_heroes deck_heroes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deck_heroes
    ADD CONSTRAINT deck_heroes_pkey PRIMARY KEY (preset_deck_id, hero_number);


--
-- Name: decks decks_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decks
    ADD CONSTRAINT decks_code_key UNIQUE (code);


--
-- Name: decks decks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decks
    ADD CONSTRAINT decks_pkey PRIMARY KEY (id);


--
-- Name: game_chat game_chat_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_chat
    ADD CONSTRAINT game_chat_pkey PRIMARY KEY (id);


--
-- Name: game_players game_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_players
    ADD CONSTRAINT game_players_pkey PRIMARY KEY (game_id, player_id);


--
-- Name: game_zones game_zones_game_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_zones
    ADD CONSTRAINT game_zones_game_unique UNIQUE (game_id, zone_position, player_id);


--
-- Name: game_zones game_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_zones
    ADD CONSTRAINT game_zones_pkey PRIMARY KEY (id);


--
-- Name: games games_lobby_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_lobby_id_key UNIQUE (lobby_id);


--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);


--
-- Name: lands lands_land_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lands
    ADD CONSTRAINT lands_land_type_key UNIQUE (land_type);


--
-- Name: lands lands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lands
    ADD CONSTRAINT lands_pkey PRIMARY KEY (id);


--
-- Name: lobbies lobbies_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lobbies
    ADD CONSTRAINT lobbies_code_key UNIQUE (code);


--
-- Name: lobbies lobbies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lobbies
    ADD CONSTRAINT lobbies_pkey PRIMARY KEY (id);


--
-- Name: lobby_players lobby_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lobby_players
    ADD CONSTRAINT lobby_players_pkey PRIMARY KEY (lobby_id, player_id);


--
-- Name: preset_deck_cards preset_deck_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_deck_cards
    ADD CONSTRAINT preset_deck_cards_pkey PRIMARY KEY (preset_deck_id, card_id, slot);


--
-- Name: preset_decks preset_decks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_decks
    ADD CONSTRAINT preset_decks_pkey PRIMARY KEY (id);


--
-- Name: preset_decks preset_decks_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_decks
    ADD CONSTRAINT preset_decks_slug_key UNIQUE (slug);


--
-- Name: game_players game_players_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER game_players_validate BEFORE UPDATE ON public.game_players FOR EACH ROW EXECUTE FUNCTION public.validate_game_player_before_write();


--
-- Name: game_zones game_zones_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER game_zones_validate BEFORE UPDATE ON public.game_zones FOR EACH ROW EXECUTE FUNCTION public.validate_game_zone_before_write();


--
-- Name: games games_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER games_validate BEFORE UPDATE ON public.games FOR EACH ROW EXECUTE FUNCTION public.validate_game_before_write();


--
-- Name: card_art card_art_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_art
    ADD CONSTRAINT card_art_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: deck_heroes deck_heroes_preset_deck_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deck_heroes
    ADD CONSTRAINT deck_heroes_preset_deck_id_fkey FOREIGN KEY (preset_deck_id) REFERENCES public.preset_decks(id);


--
-- Name: game_chat game_chat_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_chat
    ADD CONSTRAINT game_chat_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);


--
-- Name: game_players game_players_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_players
    ADD CONSTRAINT game_players_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);


--
-- Name: game_zones game_zones_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_zones
    ADD CONSTRAINT game_zones_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);


--
-- Name: games games_lobby_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id);


--
-- Name: lobbies lobbies_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lobbies
    ADD CONSTRAINT lobbies_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);


--
-- Name: lobby_players lobby_players_lobby_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lobby_players
    ADD CONSTRAINT lobby_players_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id);


--
-- Name: preset_deck_cards preset_deck_cards_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_deck_cards
    ADD CONSTRAINT preset_deck_cards_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: preset_deck_cards preset_deck_cards_preset_deck_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_deck_cards
    ADD CONSTRAINT preset_deck_cards_preset_deck_id_fkey FOREIGN KEY (preset_deck_id) REFERENCES public.preset_decks(id);


--
-- Name: game_players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;

--
-- Name: game_players game_players_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_players_insert ON public.game_players FOR INSERT WITH CHECK (((player_id = current_setting('app.guest_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_players.game_id) AND public.is_lobby_member(g.lobby_id))))));


--
-- Name: game_players game_players_realtime_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_players_realtime_bypass ON public.game_players FOR SELECT USING (true);


--
-- Name: game_players game_players_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_players_select ON public.game_players FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_players.game_id) AND public.is_lobby_member(g.lobby_id)))));


--
-- Name: game_players game_players_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_players_update ON public.game_players FOR UPDATE USING (((player_id = current_setting('app.guest_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_players.game_id) AND public.is_lobby_member(g.lobby_id))))));


--
-- Name: game_zones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_zones ENABLE ROW LEVEL SECURITY;

--
-- Name: game_zones game_zones_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_zones_insert ON public.game_zones FOR INSERT WITH CHECK (((player_id = current_setting('app.guest_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_zones.game_id) AND public.is_lobby_member(g.lobby_id))))));


--
-- Name: game_zones game_zones_realtime_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_zones_realtime_bypass ON public.game_zones FOR SELECT USING (true);


--
-- Name: game_zones game_zones_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_zones_select ON public.game_zones FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_zones.game_id) AND public.is_lobby_member(g.lobby_id)))));


--
-- Name: game_zones game_zones_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_zones_update ON public.game_zones FOR UPDATE USING (((player_id = current_setting('app.guest_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_zones.game_id) AND public.is_lobby_member(g.lobby_id))))));


--
-- Name: games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

--
-- Name: games games_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY games_delete ON public.games FOR DELETE USING (public.is_lobby_member(lobby_id));


--
-- Name: games games_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY games_insert ON public.games FOR INSERT WITH CHECK (public.is_lobby_member(lobby_id));


--
-- Name: games games_realtime_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY games_realtime_bypass ON public.games FOR SELECT USING (true);


--
-- Name: games games_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY games_select ON public.games FOR SELECT USING (public.is_lobby_member(lobby_id));


--
-- Name: games games_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY games_update ON public.games FOR UPDATE USING (public.is_lobby_member(lobby_id));


--
-- Name: lobbies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lobbies ENABLE ROW LEVEL SECURITY;

--
-- Name: lobbies lobbies_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lobbies_delete ON public.lobbies FOR DELETE USING ((host_id = current_setting('app.guest_id'::text, true)));


--
-- Name: lobbies lobbies_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lobbies_insert ON public.lobbies FOR INSERT WITH CHECK (true);


--
-- Name: lobbies lobbies_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lobbies_select ON public.lobbies FOR SELECT USING (true);


--
-- Name: lobbies lobbies_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lobbies_update ON public.lobbies FOR UPDATE USING ((host_id = current_setting('app.guest_id'::text, true)));


--
-- Name: lobby_players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lobby_players ENABLE ROW LEVEL SECURITY;

--
-- Name: lobby_players lobby_players_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lobby_players_delete ON public.lobby_players FOR DELETE USING ((player_id = current_setting('app.guest_id'::text, true)));


--
-- Name: lobby_players lobby_players_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lobby_players_insert ON public.lobby_players FOR INSERT WITH CHECK ((player_id = current_setting('app.guest_id'::text, true)));


--
-- Name: lobby_players lobby_players_realtime_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lobby_players_realtime_bypass ON public.lobby_players FOR SELECT USING (true);


--
-- Name: lobby_players lobby_players_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lobby_players_select ON public.lobby_players FOR SELECT USING (((player_id = current_setting('app.guest_id'::text, true)) OR public.is_lobby_member(lobby_id)));


--
-- Name: lobby_players lobby_players_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lobby_players_update ON public.lobby_players FOR UPDATE USING ((player_id = current_setting('app.guest_id'::text, true)));


--
-- PostgreSQL database dump complete
--

\unrestrict 8sXZIQm2CwGafVdx7PcDJR6GfmdV0q1ufyb68QFDOcrDYHrRDwK8KVHluny86zI

