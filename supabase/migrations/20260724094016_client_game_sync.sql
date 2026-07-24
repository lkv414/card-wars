-- ============================================================
-- Migration: client_game_sync
-- Создаёт 4 игровые таблицы + добавляет критичные поля +
-- включает Realtime. Без RLS (как и базовые таблицы — RLS=false).
-- Идемпотентный: можно запускать несколько раз.
-- ============================================================

-- ------------------------------------------------------------
-- 1. GAMES TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.games (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  lobby_id          uuid UNIQUE,
  status            text DEFAULT 'setup'::text
                      CHECK (status = ANY (ARRAY['setup'::text, 'active'::text, 'finished'::text])),
  current_turn      integer DEFAULT 0,
  current_player_id text,
  game_state        jsonb DEFAULT '{}'::jsonb,
  created_at        timestamp with time zone DEFAULT now(),
  updated_at        timestamp with time zone DEFAULT now(),
  -- наши новые поля
  winner_id         text NULL,
  started_at        timestamp with time zone NULL,
  ended_at          timestamp with time zone NULL,
  version           integer NOT NULL DEFAULT 1,
  turn_started_at   timestamp with time zone NULL,
  CONSTRAINT games_pkey PRIMARY KEY (id)
);

-- ------------------------------------------------------------
-- 2. GAME_PLAYERS TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_players (
  game_id       uuid NOT NULL,
  player_id     text NOT NULL,
  health        integer DEFAULT 25,
  hand          jsonb DEFAULT '[]'::jsonb,
  deck_remaining integer DEFAULT 35,
  position      text NOT NULL
                  CHECK (position = ANY (ARRAY['player1'::text, 'player2'::text])),
  created_at    timestamp with time zone DEFAULT now(),
  updated_at    timestamp with time zone DEFAULT now(),
  -- наши новые поля
  nickname      text NULL,
  player_order  smallint NOT NULL DEFAULT 1 CHECK (player_order BETWEEN 1 AND 4),
  last_seen     timestamp with time zone NULL,
  CONSTRAINT game_players_pkey PRIMARY KEY (game_id, player_id)
);

-- ------------------------------------------------------------
-- 3. GAME_ZONES TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_zones (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  game_id       uuid NOT NULL,
  zone_position integer NOT NULL CHECK (zone_position >= 1 AND zone_position <= 4),
  player_id     text NOT NULL,
  cards         jsonb DEFAULT '[]'::jsonb,
  land_id       uuid,
  created_at    timestamp with time zone DEFAULT now(),
  updated_at    timestamp with time zone DEFAULT now(),
  CONSTRAINT game_zones_pkey PRIMARY KEY (id),
  CONSTRAINT game_zones_game_unique UNIQUE (game_id, zone_position, player_id)
);

-- ------------------------------------------------------------
-- 4. GAME_CHAT TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_chat (
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  game_id    uuid NOT NULL,
  player_id  text NOT NULL,
  message    text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT game_chat_pkey PRIMARY KEY (id)
);

-- ------------------------------------------------------------
-- 5. FOREIGN KEYS (idempotent)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_lobby_id_fkey'
  ) THEN
    ALTER TABLE public.games
      ADD CONSTRAINT games_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_players_game_id_fkey'
  ) THEN
    ALTER TABLE public.game_players
      ADD CONSTRAINT game_players_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_zones_game_id_fkey'
  ) THEN
    ALTER TABLE public.game_zones
      ADD CONSTRAINT game_zones_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_chat_game_id_fkey'
  ) THEN
    ALTER TABLE public.game_chat
      ADD CONSTRAINT game_chat_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 6. INDEXES
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_games_status        ON public.games(status);
CREATE INDEX IF NOT EXISTS idx_games_current_player ON public.games(current_player_id);
CREATE INDEX IF NOT EXISTS idx_games_active        ON public.games(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_game_zones_game_id   ON public.game_zones(game_id);
CREATE INDEX IF NOT EXISTS idx_game_zones_player_position ON public.game_zones(game_id, player_id, zone_position);
CREATE INDEX IF NOT EXISTS idx_game_chat_game_id    ON public.game_chat(game_id);

-- ------------------------------------------------------------
-- 7. REALTIME PUBLICATION
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'games'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'game_players'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.game_players;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'game_zones'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.game_zones;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'game_chat'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.game_chat;
    END IF;
  END IF;
END $$;

-- ============================================================
-- Готово. RLS-политики НЕ добавляем: на базовых таблицах RLS=false,
-- и dev-режим работает с anon-ключом. Для прода RLS-политики
-- закрываются отдельной migration (auth.uid() based).
-- ============================================================
