-- Найти все триггеры на game_players
SELECT
    tgname AS trigger_name,
    tgrelid::regclass AS table_name,
    proname AS function_name
FROM pg_trigger
WHERE tgrelid = 'public.game_players'::regclass
    AND NOT tgisinternal;
