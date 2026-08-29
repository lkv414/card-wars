-- Диагностика: показать все триггеры и check constraints на game_players
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '=== TRIGGERS ON game_players ===';
    FOR rec IN
        SELECT tg.tgname, p.proname AS func_name
        FROM pg_trigger tg
        JOIN pg_proc p ON p.oid = tg.tgfoid
        WHERE tg.tgrelid = 'public.game_players'::regclass
          AND NOT tg.tgisinternal
    LOOP
        RAISE NOTICE 'Trigger: %, Function: %', rec.tgname, rec.func_name;
    END LOOP;

    RAISE NOTICE '=== CHECK CONSTRAINTS ON game_players ===';
    FOR rec IN
        SELECT conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'public.game_players'::regclass
          AND contype = 'c'
    LOOP
        RAISE NOTICE 'Constraint: % = %', rec.conname, rec.def;
    END LOOP;
END $$;

-- Удаляем ВСЕ триггеры на game_players (кроме системных)
DROP TRIGGER IF EXISTS game_players_hand_length_check ON public.game_players;
DROP TRIGGER IF EXISTS check_game_players_hand_length ON public.game_players;
DROP TRIGGER IF EXISTS validate_hand_length ON public.game_players;
DROP TRIGGER IF EXISTS trg_check_hand_length ON public.game_players;
DROP TRIGGER IF EXISTS check_hand_length ON public.game_players;

-- Удаляем функции, если остались
DROP FUNCTION IF EXISTS public.check_game_players_hand_length();
DROP FUNCTION IF EXISTS public.validate_hand_length();
DROP FUNCTION IF EXISTS public.check_hand_length();

-- Удаляем check constraints (если лимит на колонке)
ALTER TABLE public.game_players DROP CONSTRAINT IF EXISTS game_players_hand_length_check;
ALTER TABLE public.game_players DROP CONSTRAINT IF EXISTS game_players_hand_check;
