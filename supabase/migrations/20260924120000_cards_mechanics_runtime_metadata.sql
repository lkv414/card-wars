-- Move the card catalog metadata to the mechanics runtime contract.
--
-- This migration deliberately does not mark any existing mechanic as executable.
-- The normalized cards.json catalog is structurally valid, but runtime review is
-- still required before rows may receive mechanics_status = 'implemented'.

BEGIN;

-- 1. Add nullable columns first so this remains safe on databases where an
-- earlier, partially applied deployment may already contain one of them.
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS mechanics_version smallint,
  ADD COLUMN IF NOT EXISTS mechanics_status text;

-- Old rows and explicitly inserted NULLs become the canonical empty list.
-- Non-array values are not rewritten: they are surfaced by the preflight below
-- so that unexpected data is never silently normalized.
UPDATE public.cards
SET mechanics = '[]'::jsonb
WHERE mechanics IS NULL;

DO $preflight$
DECLARE
  invalid_count bigint;
BEGIN
  SELECT count(*)
  INTO invalid_count
  FROM public.cards
  WHERE jsonb_typeof(mechanics) <> 'array';

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Cannot enable public.cards mechanics runtime contract: % row(s) have non-array JSONB mechanics',
      invalid_count;
  END IF;
END;
$preflight$;

-- Existing normalized catalog data uses contract v1 and remains unreviewed.
-- In particular, supported action names are not treated as proof that a
-- handler is registered and executable.
UPDATE public.cards
SET mechanics_version = 1
WHERE mechanics_version IS NULL;

UPDATE public.cards
SET mechanics_status = 'unreviewed'
WHERE mechanics_status IS NULL;

ALTER TABLE public.cards
  ALTER COLUMN mechanics SET DEFAULT '[]'::jsonb,
  ALTER COLUMN mechanics SET NOT NULL,
  ALTER COLUMN mechanics_version SET DEFAULT 1,
  ALTER COLUMN mechanics_version SET NOT NULL,
  ALTER COLUMN mechanics_status SET DEFAULT 'unreviewed',
  ALTER COLUMN mechanics_status SET NOT NULL;

-- 2. Enforce only the inexpensive, stable storage invariant on the hot write
-- path. Detailed action/trigger semantics remain application-registry concerns.
ALTER TABLE public.cards
  DROP CONSTRAINT IF EXISTS cards_mechanics_array_check;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_mechanics_array_check
  CHECK (
    mechanics IS NOT NULL
    AND jsonb_typeof(mechanics) = 'array'
  ) NOT VALID;

ALTER TABLE public.cards
  VALIDATE CONSTRAINT cards_mechanics_array_check;

ALTER TABLE public.cards
  DROP CONSTRAINT IF EXISTS cards_mechanics_version_check;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_mechanics_version_check
  CHECK (mechanics_version >= 1) NOT VALID;

ALTER TABLE public.cards
  VALIDATE CONSTRAINT cards_mechanics_version_check;

ALTER TABLE public.cards
  DROP CONSTRAINT IF EXISTS cards_mechanics_status_check;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_mechanics_status_check
  CHECK (
    mechanics_status IN (
      'unreviewed',
      'text_only',
      'implemented',
      'disabled'
    )
  ) NOT VALID;

ALTER TABLE public.cards
  VALIDATE CONSTRAINT cards_mechanics_status_check;

COMMENT ON COLUMN public.cards.mechanics IS
  'Mechanics contract v1 JSONB array: [{trigger, actions[], conditions[], description, source_text}]. Empty array means no mechanic.';

COMMENT ON COLUMN public.cards.mechanics_version IS
  'Version of the JSONB mechanics envelope. Existing normalized catalog rows are v1.';

COMMENT ON COLUMN public.cards.mechanics_status IS
  'Runtime review state: unreviewed (not executable), text_only (not executable), implemented (runtime-approved), or disabled.';

COMMENT ON CONSTRAINT public.cards_mechanics_array_check ON public.cards IS
  'public.cards.mechanics must always be a non-null JSONB array.';

COMMENT ON CONSTRAINT public.cards_mechanics_status_check ON public.cards IS
  'Only known mechanics runtime review states are allowed.';

-- 3. Runtime/admin filtering by review state and contract version. Include the
-- stable card key used by catalog consumers so common status views avoid a
-- heap lookup.
CREATE INDEX IF NOT EXISTS cards_mechanics_runtime_idx
  ON public.cards (mechanics_status, mechanics_version, card_number)
  INCLUDE (id);

-- The existing full mechanics GIN index remains useful for audits. This
-- partial index is smaller and covers the read path that may execute data.
CREATE INDEX IF NOT EXISTS cards_mechanics_implemented_gin_idx
  ON public.cards USING gin (mechanics jsonb_path_ops)
  WHERE mechanics_status = 'implemented';

-- 4. Structural validator for seeds and CI. It intentionally does not decide
-- whether a trigger/action is supported: the runtime action registry is the
-- source of truth, and unknown actions must not be enumerated in SQL.
CREATE OR REPLACE FUNCTION public.validate_card_mechanics_contract_v1(
  p_mechanics jsonb,
  p_mechanics_version smallint DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $function$
DECLARE
  v_mechanic jsonb;
  v_action jsonb;
  v_condition jsonb;
BEGIN
  IF p_mechanics IS NULL
     OR p_mechanics_version IS NULL
     OR p_mechanics_version <> 1
     OR jsonb_typeof(p_mechanics) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  FOR v_mechanic IN
    SELECT value
    FROM jsonb_array_elements(p_mechanics)
  LOOP
    IF jsonb_typeof(v_mechanic) IS DISTINCT FROM 'object'
       OR COALESCE(btrim(v_mechanic ->> 'trigger'), '') = ''
       OR jsonb_typeof(v_mechanic -> 'actions') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_mechanic -> 'conditions') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_mechanic -> 'description') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_mechanic -> 'source_text') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;

    FOR v_action IN
      SELECT value
      FROM jsonb_array_elements(v_mechanic -> 'actions')
    LOOP
      IF jsonb_typeof(v_action) IS DISTINCT FROM 'object'
         OR COALESCE(btrim(v_action ->> 'type'), '') = '' THEN
        RETURN false;
      END IF;
    END LOOP;

    FOR v_condition IN
      SELECT value
      FROM jsonb_array_elements(v_mechanic -> 'conditions')
    LOOP
      IF jsonb_typeof(v_condition) IS DISTINCT FROM 'object'
         OR COALESCE(btrim(v_condition ->> 'type'), '') = '' THEN
        RETURN false;
      END IF;
    END LOOP;
  END LOOP;

  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.validate_card_mechanics_contract_v1(jsonb, smallint) IS
  'Validates the mechanics v1 storage envelope only. It does not imply that triggers or actions are executable.';

-- Admin/seed audit: returns only catalog rows that fail the v1 envelope.
-- Detailed distributions and unknown action/trigger reports remain in
-- individual_cards/mechanics_engine_audit.sql.
CREATE OR REPLACE FUNCTION public.audit_card_mechanics_contract_v1()
RETURNS TABLE (
  card_id uuid,
  card_number integer,
  card_name text,
  version smallint,
  status text,
  valid_v1 boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    c.id,
    c.card_number,
    c.name,
    c.mechanics_version,
    c.mechanics_status,
    public.validate_card_mechanics_contract_v1(
      c.mechanics,
      c.mechanics_version
    ) AS valid_v1
  FROM public.cards AS c
  WHERE NOT public.validate_card_mechanics_contract_v1(
    c.mechanics,
    c.mechanics_version
  )
  ORDER BY c.card_number, c.id;
$function$;

COMMENT ON FUNCTION public.audit_card_mechanics_contract_v1() IS
  'Read-only audit of public.cards rows that fail the mechanics v1 structural envelope.';

-- Keep these maintenance helpers out of the public RPC surface.
REVOKE ALL ON FUNCTION public.validate_card_mechanics_contract_v1(jsonb, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_card_mechanics_contract_v1() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
