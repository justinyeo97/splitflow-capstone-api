\set ON_ERROR_STOP on
BEGIN;
-- This installs the application into an empty Supabase database. It never drops existing data.
DO $$ BEGIN
  IF to_regclass('public.profiles') IS NOT NULL OR to_regclass('public.companies') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public') THEN
    RAISE EXCEPTION 'Application schema is not empty. Rebuild refused; no data has been deleted.';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
SET LOCAL search_path = public, extensions;
\ir ../supabase/migrations/20261018112136_create_tables.sql
\ir ../supabase/migrations/20261018112243_secure_tables.sql
\ir ../supabase/migrations/20261018112318_protect_role_helper.sql
\ir core-columns.sql
\ir ../docs/database-proposals/company-setup.sql
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='btree_gist' AND n.nspname<>'extensions') THEN
    ALTER EXTENSION btree_gist SET SCHEMA extensions;
  END IF;
END $$;
\ir ../docs/database-proposals/consultant-invites.sql
\ir enable-deletion.sql
\ir audit-log.sql
\ir company-creation.sql
\ir scheduled-retries.sql
COMMIT;
