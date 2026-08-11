-- ====================================================================
-- Migration: extend cards + card_art + preset_decks + preset_deck_cards
-- Идемпотентная: безопасно применять поверх существующей production БД
-- ====================================================================

-- ── Расширение таблицы cards (новые колонки из каталога) ──
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS rarity text
  CHECK (rarity IS NULL OR rarity IN ('common','uncommon','rare','promo'));
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS hero text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS notes text;

-- land_type / is_rainbow могут уже существовать — IF NOT EXISTS безопасен
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS land_type text DEFAULT 'any';
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS is_rainbow boolean DEFAULT false;

-- card_number: добавить индекс если колонка уже есть
CREATE INDEX IF NOT EXISTS cards_card_number_idx ON public.cards (card_number);
CREATE INDEX IF NOT EXISTS cards_name_idx ON public.cards (name);
CREATE INDEX IF NOT EXISTS cards_hero_idx ON public.cards (hero);
CREATE INDEX IF NOT EXISTS cards_land_type_idx ON public.cards (land_type);
CREATE INDEX IF NOT EXISTS cards_card_type_idx ON public.cards (card_type);
CREATE INDEX IF NOT EXISTS cards_source_idx ON public.cards (source);
CREATE INDEX IF NOT EXISTS cards_has_flip_idx ON public.cards (has_flip);

-- updated_at trigger (если ещё нет)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cards_set_updated_at ON public.cards;
CREATE TRIGGER cards_set_updated_at
  BEFORE UPDATE ON public.cards
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ====================================================================
-- card_art — арт одной карты
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.card_art (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_kind text NOT NULL DEFAULT 'local'
    CHECK (source_kind IN ('local','storage','url')),
  is_primary boolean NOT NULL DEFAULT true,
  variant text,
  width int,
  height int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS card_art_card_id_idx ON public.card_art (card_id);

-- ====================================================================
-- preset_decks — готовые колоды героев
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.preset_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  hero_slug text NOT NULL,
  mode text NOT NULL DEFAULT 'standard'
    CHECK (mode IN ('standard','doubles')),
  landscapes jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS preset_decks_slug_idx ON public.preset_decks (slug);
CREATE INDEX IF NOT EXISTS preset_decks_mode_idx ON public.preset_decks (mode);

-- ====================================================================
-- preset_deck_cards — связь many-to-many
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.preset_deck_cards (
  preset_deck_id uuid NOT NULL REFERENCES public.preset_decks(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE RESTRICT,
  slot int NOT NULL,
  is_landscape boolean NOT NULL DEFAULT false,
  PRIMARY KEY (preset_deck_id, card_id, slot)
);

CREATE INDEX IF NOT EXISTS preset_deck_cards_deck_idx ON public.preset_deck_cards (preset_deck_id);
CREATE INDEX IF NOT EXISTS preset_deck_cards_card_idx ON public.preset_deck_cards (card_id);

-- ====================================================================
-- RLS — read-only для всех, write только service_role
-- ====================================================================
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_art ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preset_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preset_deck_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cards_read_all" ON public.cards;
CREATE POLICY "cards_read_all" ON public.cards FOR SELECT USING (true);

DROP POLICY IF EXISTS "card_art_read_all" ON public.card_art;
CREATE POLICY "card_art_read_all" ON public.card_art FOR SELECT USING (true);

DROP POLICY IF EXISTS "preset_decks_read_all" ON public.preset_decks;
CREATE POLICY "preset_decks_read_all" ON public.preset_decks FOR SELECT USING (true);

DROP POLICY IF EXISTS "preset_deck_cards_read_all" ON public.preset_deck_cards;
CREATE POLICY "preset_deck_cards_read_all" ON public.preset_deck_cards FOR SELECT USING (true);

-- Без policy на INSERT/UPDATE/DELETE — anon/authenticated запрещены по умолчанию
-- service_role bypass RLS — для миграций и скриптов
