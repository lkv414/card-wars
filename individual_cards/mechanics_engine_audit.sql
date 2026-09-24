-- Mechanics engine audit (read-only)
-- Source contract: individual_cards/cards.json
-- This file does not change data and is safe to run in Supabase SQL Editor.
-- It audits the current public.cards table before the mechanics runtime rewrite.

-- 1. Basic catalog counts.
SELECT
  COUNT(*) AS cards,
  COUNT(*) FILTER (WHERE jsonb_typeof(mechanics) = 'array') AS mechanics_array,
  COUNT(*) FILTER (WHERE mechanics IS NULL) AS mechanics_null,
  COUNT(*) FILTER (WHERE mechanics IS NOT NULL AND jsonb_typeof(mechanics) <> 'array') AS mechanics_not_array
FROM public.cards;

-- 2. Invalid mechanic envelope: every item must be an object with trigger,
-- actions[], conditions[], description and source_text.
SELECT
  c.id,
  c.card_number,
  c.name,
  m.ordinality AS mechanic_index,
  m.mechanic
FROM public.cards AS c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.mechanics) = 'array' THEN c.mechanics ELSE '[]'::jsonb END
) WITH ORDINALITY AS m(mechanic, ordinality)
WHERE jsonb_typeof(m.mechanic) <> 'object'
   OR NOT (m.mechanic ? 'trigger')
   OR NOT (m.mechanic ? 'actions')
   OR NOT (m.mechanic ? 'conditions')
   OR jsonb_typeof(m.mechanic -> 'actions') <> 'array'
   OR jsonb_typeof(m.mechanic -> 'conditions') <> 'array'
ORDER BY c.card_number, m.ordinality;

-- 3. Unknown triggers and action types.
WITH expanded AS (
  SELECT
    c.id,
    c.card_number,
    c.name,
    m.value AS mechanic,
    a.value AS action
  FROM public.cards AS c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.mechanics) = 'array' THEN c.mechanics ELSE '[]'::jsonb END
  ) AS m(value)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(m.value -> 'actions') = 'array'
         THEN m.value -> 'actions' ELSE '[]'::jsonb END
  ) AS a(value)
)
SELECT 'trigger' AS kind, mechanic ->> 'trigger' AS value, COUNT(*) AS rows
FROM expanded
WHERE mechanic ->> 'trigger' NOT IN (
  'manual', 'on_enters_play', 'on_flip', 'start_of_turn',
  'start_of_next_turn', 'end_of_turn', 'on_creature_attacks',
  'on_damage_dealt', 'on_damage_taken', 'on_death', 'on_discard',
  'on_line_change', 'on_draw', 'persistent', 'conditional'
)
GROUP BY 1, 2
UNION ALL
SELECT 'action', action ->> 'type', COUNT(*)
FROM expanded
WHERE action ->> 'type' NOT IN (
  'deal_damage', 'aoe_damage', 'heal', 'draw_cards', 'discard_cards',
  'search', 'destroy', 'move', 'return_from_discard', 'flip_landscape',
  'freeze_landscape', 'stat_buff', 'gain_actions', 'manual', 'passive',
  'flip_ability', 'ignore_damage', 'face_attack', 'play_for_free',
  'cost_reduction', 'immunity', 'imperative', 'peek', 'mill'
)
GROUP BY 1, 2
ORDER BY 1, 2;

-- 4. Generic/text-only actions. These must not be executed until handlers exist.
SELECT
  c.id,
  c.card_number,
  c.name,
  m.ordinality AS mechanic_index,
  a.ordinality AS action_index,
  a.action ->> 'type' AS action_type,
  a.action ->> 'effect' AS effect,
  a.action ->> 'source_type' AS source_type
FROM public.cards AS c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.mechanics) = 'array' THEN c.mechanics ELSE '[]'::jsonb END
) WITH ORDINALITY AS m(mechanic, ordinality)
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(m.mechanic -> 'actions') = 'array'
       THEN m.mechanic -> 'actions' ELSE '[]'::jsonb END
) WITH ORDINALITY AS a(action, ordinality)
WHERE a.action ? 'source_type'
   OR a.action ->> 'type' IN ('imperative', 'passive', 'manual')
ORDER BY c.card_number, m.ordinality, a.ordinality;

-- 5. Trigger distribution. This is descriptive only; it does not mean the
-- trigger is implemented by the current Worker runtime.
SELECT
  m.mechanic ->> 'trigger' AS trigger,
  COUNT(*) AS mechanic_count
FROM public.cards AS c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.mechanics) = 'array' THEN c.mechanics ELSE '[]'::jsonb END
) AS m(mechanic)
GROUP BY 1
ORDER BY mechanic_count DESC, 1;

-- 6. Action distribution. See docs/MECHANICS_ENGINE_AUDIT.md: hydration is
-- not execution, and the current Worker does not dispatch these actions yet.
SELECT
  a.action ->> 'type' AS action_type,
  COUNT(*) AS action_count
FROM public.cards AS c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.mechanics) = 'array' THEN c.mechanics ELSE '[]'::jsonb END
) AS m(mechanic)
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(m.mechanic -> 'actions') = 'array'
       THEN m.mechanic -> 'actions' ELSE '[]'::jsonb END
) AS a(action)
GROUP BY 1
ORDER BY action_count DESC, 1;

-- 7. Current source type issue: inspect before adding a future CHECK constraint.
SELECT card_type, COUNT(*)
FROM public.cards
GROUP BY card_type
ORDER BY card_type;

-- 8. Duplicate card numbers. The generated individual seed intentionally uses
-- global catalog numbers 100001..100504; this query must return no duplicates.
SELECT card_number, COUNT(*)
FROM public.cards
GROUP BY card_number
HAVING COUNT(*) > 1
ORDER BY card_number;
