-- Cleanup for stale anonymous lobbies.
-- A lobby is stale after two hours without recent activity. The current
-- schema has no last_activity_at column, so created_at is the safe fallback.

CREATE OR REPLACE FUNCTION public.cleanup_stale_lobbies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH stale AS (
    SELECT id
    FROM public.lobbies
    WHERE created_at < now() - interval '2 hours'
      AND status IN ('waiting', 'in_game')
  ), deleted AS (
    DELETE FROM public.lobbies l
    USING stale s
    WHERE l.id = s.id
    RETURNING l.id
  )
  SELECT count(*)::integer INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_lobbies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_lobbies() TO postgres, service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'cleanup-stale-lobbies-every-hour';

SELECT cron.schedule(
  'cleanup-stale-lobbies-every-hour',
  '0 * * * *',
  $$SELECT public.cleanup_stale_lobbies();$$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-stale-lobbies-every-hour'
);
