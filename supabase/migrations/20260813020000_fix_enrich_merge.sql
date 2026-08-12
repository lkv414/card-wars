-- Fix enrich merge: runtime null/empty must not wipe catalog image_url/name

CREATE OR REPLACE FUNCTION public.enrich_card_jsonb(p_card jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_id text;
  v_db public.cards%ROWTYPE;
BEGIN
  IF p_card IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_card) = 'string' THEN
    v_id := p_card #>> '{}';
  ELSIF jsonb_typeof(p_card) = 'object' THEN
    v_id := COALESCE(NULLIF(p_card->>'id', ''), NULLIF(p_card->>'card_id', ''));
  ELSE
    RETURN p_card;
  END IF;

  IF v_id IS NULL THEN
    RETURN p_card;
  END IF;

  BEGIN
    SELECT * INTO v_db FROM public.cards c WHERE c.id = v_id::uuid LIMIT 1;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN p_card;
  END;

  IF NOT FOUND THEN
    RETURN p_card;
  END IF;

  RETURN p_card || jsonb_build_object(
    'id', COALESCE(NULLIF(p_card->>'id', ''), v_db.id::text),
    'card_number', v_db.card_number,
    'name', COALESCE(NULLIF(p_card->>'name', ''), v_db.name),
    'description', COALESCE(NULLIF(p_card->>'description', ''), v_db.description),
    'card_type', COALESCE(NULLIF(p_card->>'card_type', ''), NULLIF(p_card->>'type', ''), v_db.card_type),
    'type', COALESCE(NULLIF(p_card->>'type', ''), NULLIF(p_card->>'card_type', ''), v_db.card_type),
    'cost', COALESCE(NULLIF(p_card->>'cost', '')::int, v_db.cost),
    'attack', COALESCE(NULLIF(p_card->>'attack', '')::int, v_db.attack),
    'health', COALESCE(NULLIF(p_card->>'health', '')::int, v_db.health),
    'land_type', COALESCE(NULLIF(p_card->>'land_type', ''), v_db.land_type),
    'image_url', COALESCE(NULLIF(p_card->>'image_url', ''), v_db.image_url),
    'has_flip', COALESCE((p_card->>'has_flip')::boolean, v_db.has_flip),
    'flip_description', COALESCE(NULLIF(p_card->>'flip_description', ''), v_db.flip_description),
    'is_rainbow', COALESCE((p_card->>'is_rainbow')::boolean, v_db.is_rainbow),
    'hero', COALESCE(NULLIF(p_card->>'hero', ''), v_db.hero),
    'source', COALESCE(NULLIF(p_card->>'source', ''), v_db.source)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
