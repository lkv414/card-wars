-- Add missing columns that the full_dump.sql expects but DB_SCHEMA.sql doesn't include.
-- These are normally added by incremental migrations after the base schema.

-- === lobbies: columns added by migrations ===
ALTER TABLE public.lobbies ADD COLUMN IF NOT EXISTS mode text DEFAULT 'standard';
ALTER TABLE public.lobbies ADD COLUMN IF NOT EXISTS turn_time_seconds integer DEFAULT 30;
ALTER TABLE public.lobbies ADD COLUMN IF NOT EXISTS min_level integer DEFAULT 1;
ALTER TABLE public.lobbies ADD COLUMN IF NOT EXISTS max_level integer DEFAULT 1;
ALTER TABLE public.lobbies ADD COLUMN IF NOT EXISTS password text;
ALTER TABLE public.lobbies ADD COLUMN IF NOT EXISTS current_players integer DEFAULT 0;
ALTER TABLE public.lobbies ADD COLUMN IF NOT EXISTS is_ranked boolean DEFAULT false;
ALTER TABLE public.lobbies ADD COLUMN IF NOT EXISTS landscape text;
ALTER TABLE public.lobbies ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.lobbies ADD COLUMN IF NOT EXISTS game_id uuid;

-- === cards: columns added by migrations ===
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS rarity text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS hero text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS notes text;

-- === game_players: columns added by migrations ===
ALTER TABLE public.game_players ADD COLUMN IF NOT EXISTS discard_pile jsonb DEFAULT '[]';
ALTER TABLE public.game_players ADD COLUMN IF NOT EXISTS land_setup_ready boolean DEFAULT false;
ALTER TABLE public.game_players ADD COLUMN IF NOT EXISTS actions_remaining integer DEFAULT 0;
ALTER TABLE public.game_players ADD COLUMN IF NOT EXISTS free_draw_used boolean DEFAULT false;
ALTER TABLE public.game_players ADD COLUMN IF NOT EXISTS paid_draw_used boolean DEFAULT false;

-- === game_zones: extra columns (if needed) ===
-- game_zones has: id, game_id, zone_position, player_id, cards, land_id, created_at, updated_at — matches DB_SCHEMA

-- === lobbies: game_id FK to games (if not exists) ===
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lobbies_game_id_fkey'
    ) THEN
        ALTER TABLE public.lobbies
            ADD CONSTRAINT lobbies_game_id_fkey
            FOREIGN KEY (game_id) REFERENCES public.games(id);
    END IF;
END $$;

-- === preset_decks: columns added by migrations ===
-- preset_decks created by migration 20260802100000 — ensure table exists
CREATE TABLE IF NOT EXISTS public.preset_decks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    slug text NOT NULL,
    name text NOT NULL,
    hero_slug text NOT NULL,
    mode text NOT NULL DEFAULT 'standard',
    landscapes jsonb NOT NULL DEFAULT '[]'::jsonb,
    description text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    winrate numeric(5,2) DEFAULT 52.00,
    CONSTRAINT preset_decks_pkey PRIMARY KEY (id),
    CONSTRAINT preset_decks_slug_key UNIQUE (slug)
);

-- === preset_deck_cards ===
CREATE TABLE IF NOT EXISTS public.preset_deck_cards (
    preset_deck_id uuid NOT NULL,
    card_id uuid NOT NULL,
    slot integer NOT NULL,
    is_landscape boolean DEFAULT false,
    CONSTRAINT preset_deck_cards_pkey PRIMARY KEY (preset_deck_id, card_id, slot)
);

-- === deck_heroes ===
CREATE TABLE IF NOT EXISTS public.deck_heroes (
    preset_deck_id uuid NOT NULL,
    hero_number text NOT NULL,
    is_primary boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT deck_heroes_pkey PRIMARY KEY (preset_deck_id, hero_number)
);

-- === card_art ===
CREATE TABLE IF NOT EXISTS public.card_art (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    card_id uuid,
    source_url text,
    source_kind text,
    is_primary boolean DEFAULT false,
    variant text,
    width integer,
    height integer,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT card_art_pkey PRIMARY KEY (id)
);

-- === Heroes (capital H) — added by seedmechanics ===
CREATE TABLE IF NOT EXISTS public."Heroes" (
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
    land_type text DEFAULT 'any',
    is_rainbow boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    id text,
    CONSTRAINT "Heroes_pkey" PRIMARY KEY (hero_number)
);

-- === FK constraints for new tables ===
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'deck_heroes_preset_deck_id_fkey'
    ) THEN
        ALTER TABLE public.deck_heroes
            ADD CONSTRAINT deck_heroes_preset_deck_id_fkey
            FOREIGN KEY (preset_deck_id) REFERENCES public.preset_decks(id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'preset_deck_cards_preset_deck_id_fkey'
    ) THEN
        ALTER TABLE public.preset_deck_cards
            ADD CONSTRAINT preset_deck_cards_preset_deck_id_fkey
            FOREIGN KEY (preset_deck_id) REFERENCES public.preset_decks(id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'preset_deck_cards_card_id_fkey'
    ) THEN
        ALTER TABLE public.preset_deck_cards
            ADD CONSTRAINT preset_deck_cards_card_id_fkey
            FOREIGN KEY (card_id) REFERENCES public.cards(id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'card_art_card_id_fkey'
    ) THEN
        ALTER TABLE public.card_art
            ADD CONSTRAINT card_art_card_id_fkey
            FOREIGN KEY (card_id) REFERENCES public.cards(id);
    END IF;
END $$;
