-- Ф6: командные карты (card_type='special') и поля каталога, которых не было в схеме.
--
-- 1. CHECK на cards.card_type не знал 'special' — 5 командных карт (№ 6, 7, 8, 24, 40)
--    не проходили reseed (аудит 4.9.5). Тип добавлен, а не подменён на creature:
--    подмена сломала бы их командную семантику.
-- 2. rarity/source/hero/notes использовались экспортом и админкой, но в схеме
--    отсутствовали (аудит 3.1). Добавляем IF NOT EXISTS, чтобы миграция была безопасной
--    на БД, где колонки уже созданы вручную.
-- 3. Поле card_type CHECK пересоздаётся под имя, которое ищем динамически:
--    в живой БД имя констрейнта не зафиксировано миграциями.

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.cards'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%card_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.cards DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_card_type_check
  CHECK (card_type = ANY (ARRAY['creature'::text, 'building'::text, 'spell'::text, 'special'::text]));

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS rarity text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS hero text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS notes text;

-- Уникальность card_number сохраняется (cards_card_number_key). Экспорт
-- присваивает номера заново и кладёт исходный номер в notes.
