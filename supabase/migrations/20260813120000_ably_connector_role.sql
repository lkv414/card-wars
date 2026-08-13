-- Dedicated Postgres role for Ably Database Connector (LISTEN/NOTIFY on ably_outbox).
-- Set password once in Supabase SQL editor or via scripts/setup-ably-outbox-connector.mjs

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ably_connector') THEN
    CREATE ROLE ably_connector LOGIN VALID UNTIL 'infinity';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE postgres TO ably_connector;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ably_outbox TO ably_connector;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ably_nodes TO ably_connector;
GRANT USAGE, SELECT ON SEQUENCE public.ably_outbox_sequence_id_seq TO ably_connector;

COMMENT ON ROLE ably_connector IS 'Ably Postgres Database Connector — set password + use direct connection (port 5432)';
