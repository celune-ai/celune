-- Proves user_workspace_ids and user_has_permission answer only for auth.uid() when a user role
-- calls them, and keep answering for service_role. Signs up one user through the auth.users
-- trigger, asks about that user as a different user, as the user, and as service_role, then
-- rolls everything back. The CI schema job runs it after a fresh boot:
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f packages/db/scripts/check-rls-helper-guards.sql

\set owner '''a0000000-0000-4000-8000-00000000000a'''
\set stranger '''b0000000-0000-4000-8000-00000000000b'''

BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', :owner, 'authenticated', 'authenticated',
        'guard-check@example.test', '{}', now(), now());

SELECT w.id AS workspace FROM public.workspace_memberships wm
JOIN public.workspaces w ON w.id = wm.workspace_id
WHERE wm.user_id = :owner LIMIT 1 \gset

CREATE TEMP TABLE guard_results (caller text, ids integer, can_manage boolean);
GRANT ALL ON guard_results TO anon, authenticated, service_role;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  format('{"sub":"%s","role":"authenticated"}', :stranger), true) \g /dev/null
INSERT INTO guard_results SELECT 'stranger',
  (SELECT count(*) FROM public.user_workspace_ids(:owner)),
  public.user_has_permission(:owner, :'workspace', 'settings:manage');

SELECT set_config('request.jwt.claims',
  format('{"sub":"%s","role":"authenticated"}', :owner), true) \g /dev/null
INSERT INTO guard_results SELECT 'owner',
  (SELECT count(*) FROM public.user_workspace_ids(:owner)),
  public.user_has_permission(:owner, :'workspace', 'settings:manage');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true) \g /dev/null
INSERT INTO guard_results SELECT 'anon',
  (SELECT count(*) FROM public.user_workspace_ids(:owner)),
  public.user_has_permission(:owner, :'workspace', 'settings:manage');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
INSERT INTO guard_results SELECT 'service_role',
  (SELECT count(*) FROM public.user_workspace_ids(:owner)),
  public.user_has_permission(:owner, :'workspace', 'settings:manage');

RESET ROLE;
SELECT * FROM guard_results ORDER BY caller;

DO $check$
DECLARE
  got text;
BEGIN
  SELECT string_agg(format('%s=%s/%s', caller, ids, can_manage), ' ' ORDER BY caller)
  INTO got FROM guard_results;
  IF got IS DISTINCT FROM 'anon=0/f owner=1/t service_role=1/t stranger=0/f' THEN
    RAISE EXCEPTION 'RLS helper guard check failed: %', got;
  END IF;
  RAISE NOTICE 'RLS helper guards: %', got;
END;
$check$;

ROLLBACK;
