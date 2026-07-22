-- Card Game Database Schema
-- Supabase PostgreSQL Schema

-- Cards Table: All available cards in the game
CREATE TABLE public.cards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  card_number integer NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  card_type text NOT NULL CHECK (card_type = ANY (ARRAY['creature'::text, 'building'::text, 'spell'::text])),
  cost integer NOT NULL DEFAULT 1,
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
  CONSTRAINT cards_pkey PRIMARY KEY (id)
);

-- Lands Table: Game board land types (Ice, Forest, Mountain, etc)
CREATE TABLE public.lands (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  land_type text NOT NULL UNIQUE,
  description text,
  image_url text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lands_pkey PRIMARY KEY (id)
);

-- Decks Table: User-built decks
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

-- Lobbies Table: Game lobby/match setup
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

-- Lobby Players Table: Players in a lobby
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

-- Games Table: Active game instances
CREATE TABLE public.games (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lobby_id uuid UNIQUE,
  status text DEFAULT 'setup'::text CHECK (status = ANY (ARRAY['setup'::text, 'active'::text, 'finished'::text])),
  current_turn integer DEFAULT 0,
  current_player_id text,
  game_state jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT games_pkey PRIMARY KEY (id),
  CONSTRAINT games_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id)
);

-- Game State: Player states during active game
CREATE TABLE public.game_players (
  game_id uuid NOT NULL,
  player_id text NOT NULL,
  health integer DEFAULT 25,
  hand jsonb DEFAULT '[]'::jsonb,
  deck_remaining integer DEFAULT 35,
  position text NOT NULL CHECK (position = ANY (ARRAY['player1'::text, 'player2'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT game_players_pkey PRIMARY KEY (game_id, player_id),
  CONSTRAINT game_players_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id)
);

-- Game Board Zones: 4 zones per player (like UNO field layout)
CREATE TABLE public.game_zones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL,
  zone_position integer NOT NULL CHECK (zone_position >= 1 AND zone_position <= 4),
  player_id text NOT NULL,
  cards jsonb DEFAULT '[]'::jsonb,
  land_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT game_zones_pkey PRIMARY KEY (id),
  CONSTRAINT game_zones_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id),
  CONSTRAINT game_zones_land_id_fkey FOREIGN KEY (land_id) REFERENCES public.lands(id),
  UNIQUE (game_id, zone_position, player_id)
);

-- Chat/Messages: In-game messaging
CREATE TABLE public.game_chat (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL,
  player_id text NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT game_chat_pkey PRIMARY KEY (id),
  CONSTRAINT game_chat_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id)
);

-- Indexes for performance
CREATE INDEX idx_cards_card_number ON public.cards(card_number);
CREATE INDEX idx_decks_user_id ON public.decks(user_id);
CREATE INDEX idx_lobbies_code ON public.lobbies(code);
CREATE INDEX idx_games_status ON public.games(status);
CREATE INDEX idx_games_current_player ON public.games(current_player_id);
CREATE INDEX idx_game_zones_game_id ON public.game_zones(game_id);
CREATE INDEX idx_game_chat_game_id ON public.game_chat(game_id);

-- RLS Policies (to be configured in Supabase)
-- ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.game_zones ENABLE ROW LEVEL SECURITY;
-- etc...
