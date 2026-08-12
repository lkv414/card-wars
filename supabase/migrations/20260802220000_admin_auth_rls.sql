-- Admin-only writes for catalog tables (JWT app_metadata.role = 'admin').

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin',
    false
  );
$$;

DROP POLICY IF EXISTS "cards_insert_all" ON public.cards;
DROP POLICY IF EXISTS "cards_update_all" ON public.cards;
DROP POLICY IF EXISTS "cards_delete_all" ON public.cards;

CREATE POLICY "cards_admin_insert" ON public.cards
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "cards_admin_update" ON public.cards
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "cards_admin_delete" ON public.cards
  FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "card_art_read_all" ON public.card_art;
CREATE POLICY "card_art_read_all" ON public.card_art FOR SELECT USING (true);

DROP POLICY IF EXISTS "card_art_admin_insert" ON public.card_art;
DROP POLICY IF EXISTS "card_art_admin_update" ON public.card_art;
DROP POLICY IF EXISTS "card_art_admin_delete" ON public.card_art;

CREATE POLICY "card_art_admin_insert" ON public.card_art
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "card_art_admin_update" ON public.card_art
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "card_art_admin_delete" ON public.card_art
  FOR DELETE TO authenticated USING (public.is_admin());
