-- Admin panel writes cards via anon/publishable key.
-- RLS previously allowed SELECT only → UPDATE returned 0 rows → PGRST116 (.single()).

DROP POLICY IF EXISTS "cards_insert_all" ON public.cards;
CREATE POLICY "cards_insert_all" ON public.cards
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "cards_update_all" ON public.cards;
CREATE POLICY "cards_update_all" ON public.cards
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "cards_delete_all" ON public.cards;
CREATE POLICY "cards_delete_all" ON public.cards
  FOR DELETE
  USING (true);
