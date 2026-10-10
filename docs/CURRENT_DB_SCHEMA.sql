-- Current Supabase schema snapshot (provided 2026-07-22).
-- Keep this file as the local source of truth for the already-existing database
-- so development does not require re-opening Supabase just to check table shape.
-- NOTE: DB_SCHEMA.sql contains the expanded planned schema for active games.

CREATE TABLE public.cards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  card_number integer NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  card_type text NOT NULL CHECK (card_type = ANY (ARRAY['creature'::text, 'building'::text, 'spell'::text, 'special'::text])),
  cost integer NOT NULL DEFAULT 1,
  attack integer,
  health integer,
  has_flip boolean DEFAULT false,
  flip_description text,
  mechanics jsonb NOT NULL DEFAULT '[]'::jsonb,
  mechanics_version smallint NOT NULL DEFAULT 1,
  mechanics_status text NOT NULL DEFAULT 'unreviewed',
  image_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  land_type text DEFAULT 'any'::text,
  is_rainbow boolean DEFAULT false,
  rarity text,
  source text,
  hero text,
  notes text,
  CONSTRAINT cards_pkey PRIMARY KEY (id)
);

CREATE TABLE public.lands (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  land_type text NOT NULL UNIQUE,
  description text,
  image_url text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lands_pkey PRIMARY KEY (id)
);

CREATE TABLE public.decks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Моя колода'::text,
  code text NOT NULL UNIQUE,
  cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  lands jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT decks_pkey PRIMARY KEY (id)
);

CREATE TABLE public.lobbies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  host_id text NOT NULL,
  status text DEFAULT 'waiting'::text,
  deck_host jsonb,
  deck_guest jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lobbies_pkey PRIMARY KEY (id)
);

CREATE TABLE public.lobby_players (
  lobby_id uuid NOT NULL,
  player_id text NOT NULL,
  deck jsonb,
  ready boolean DEFAULT false,
  joined_at timestamp with time zone DEFAULT now(),
  nickname text,
  CONSTRAINT lobby_players_pkey PRIMARY KEY (lobby_id, player_id),
  CONSTRAINT lobby_players_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id)
);
