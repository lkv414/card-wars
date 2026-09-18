-- Base schema: table definitions extracted from DB_SCHEMA.sql
-- This creates the core tables so that subsequent migrations (which create
-- functions referencing these tables) can succeed.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
    mechanics jsonb DEFAULT '[]',
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
-- 2. CONSTRAINTS (FK, UNIQUE)
-- ============================================================

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_card_number_key;
ALTER TABLE public.cards ADD CONSTRAINT cards_card_number_key UNIQUE (card_number);

ALTER TABLE public.decks DROP CONSTRAINT IF EXISTS decks_code_key;
ALTER TABLE public.decks ADD CONSTRAINT decks_code_key UNIQUE (code);

ALTER TABLE public.game_chat DROP CONSTRAINT IF EXISTS game_chat_game_id_fkey;
ALTER TABLE public.game_chat ADD CONSTRAINT game_chat_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);

ALTER TABLE public.game_players DROP CONSTRAINT IF EXISTS game_players_game_id_fkey;
ALTER TABLE public.game_players ADD CONSTRAINT game_players_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);

ALTER TABLE public.game_zones DROP CONSTRAINT IF EXISTS game_zones_game_id_fkey;
ALTER TABLE public.game_zones ADD CONSTRAINT game_zones_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);

ALTER TABLE public.game_zones DROP CONSTRAINT IF EXISTS game_zones_game_unique;
ALTER TABLE public.game_zones ADD CONSTRAINT game_zones_game_unique UNIQUE (game_id, zone_position, player_id);

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_lobby_id_fkey;
ALTER TABLE public.games ADD CONSTRAINT games_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id);

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_lobby_id_key;
ALTER TABLE public.games ADD CONSTRAINT games_lobby_id_key UNIQUE (lobby_id);

ALTER TABLE public.lands DROP CONSTRAINT IF EXISTS lands_land_type_key;
ALTER TABLE public.lands ADD CONSTRAINT lands_land_type_key UNIQUE (land_type);

ALTER TABLE public.lobbies DROP CONSTRAINT IF EXISTS lobbies_code_key;
ALTER TABLE public.lobbies ADD CONSTRAINT lobbies_code_key UNIQUE (code);

ALTER TABLE public.lobby_players DROP CONSTRAINT IF EXISTS lobby_players_lobby_id_fkey;
ALTER TABLE public.lobby_players ADD CONSTRAINT lobby_players_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id);
