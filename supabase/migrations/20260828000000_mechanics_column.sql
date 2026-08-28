-- Migration: add structured mechanics column to cards
-- Stores parsed mechanics from scripts/parse_mechanics.py (and hydrates via workers/src/game-engine/mechanics.ts)

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS mechanics jsonb;

COMMENT ON COLUMN public.cards.mechanics IS
  'Structured mechanics: [{ trigger, actions[], conditions[], description, source_text }]';

-- GIN index enables fast filtering, e.g. cards with a given trigger/action type.
CREATE INDEX IF NOT EXISTS cards_mechanics_gin_idx ON public.cards USING gin (mechanics);
