-- Fails when the public schema exposes more than the reviewed surface to anon or authenticated.
-- The CI schema job runs it after a fresh boot:
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f packages/db/scripts/check-definer-grants.sql
--
-- 1. Every SECURITY DEFINER function in public that anon or authenticated can execute (directly
--    or through PUBLIC) must be on the allowlist below. A definer function runs as its owner and
--    skips RLS, so it must check auth.uid() itself, or be safe by design. Anything else loses
--    EXECUTE: REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated.
-- 2. Every RLS policy that calls user_workspace_ids or user_has_permission passes auth.uid() as
--    the user id; both functions answer only for auth.uid() when called by a user role.
-- 3. anon and authenticated cannot SELECT the secret columns listed below.

SET search_path = '';

DO $check$
DECLARE
  problems text[] := '{}';
  hit record;
BEGIN
  CREATE TEMP TABLE definer_allowlist (fn text PRIMARY KEY, why text NOT NULL) ON COMMIT DROP;
  INSERT INTO definer_allowlist VALUES
    -- Trigger functions. Postgres refuses to call them outside a trigger, and firing a trigger
    -- does not check EXECUTE.
    ('public.check_memory_quota()', 'trigger on agent_memory'),
    ('public.handle_new_user()', 'trigger on auth.users'),
    ('public.seed_org_roles()', 'trigger on organizations'),
    ('public.set_memory_ttl()', 'trigger on agent_memory'),
    -- RLS helpers with no arguments that answer for auth.uid() only.
    ('public.is_owner()', 'reads auth.uid()'),
    ('public.org_staff_org_ids()', 'reads auth.uid()'),
    ('public.user_admin_org_ids()', 'reads auth.uid()'),
    ('public.user_org_ids()', 'reads auth.uid()'),
    -- RLS helpers that take a user id and ignore any id other than auth.uid() for anon and
    -- authenticated (20260928_definer_rls_helpers_check_caller.sql).
    ('public.user_has_permission(uuid,uuid,text)', 'answers for auth.uid() only'),
    ('public.user_workspace_ids(uuid)', 'answers for auth.uid() only'),
    -- Functions that return rows only when auth.uid() is a member of the same workspace or org.
    ('public.check_file_overlap(uuid,uuid)', 'requires workspace membership of auth.uid()'),
    ('public.get_invitation_user(uuid)', 'requires a shared org with auth.uid()'),
    ('public.get_pending_invitations()', 'requires a shared org with auth.uid()'),
    ('public.get_users_by_ids(uuid[])', 'requires a shared org with auth.uid()'),
    -- Share-token lookup: guests open a dot voter room by its unguessable share token.
    ('public.get_dot_voter_room_by_token(text)', 'share token lookup by design');

  FOR hit IN
    SELECT p.oid::regprocedure::text AS fn
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      AND p.oid::regprocedure::text NOT IN (SELECT fn FROM definer_allowlist)
    ORDER BY 1
  LOOP
    problems := problems || format('SECURITY DEFINER %s is executable by anon or authenticated '
      'and not on the allowlist', hit.fn);
  END LOOP;

  FOR hit IN
    SELECT fn FROM definer_allowlist
    WHERE pg_catalog.to_regprocedure(fn) IS NULL
    ORDER BY 1
  LOOP
    problems := problems || format('allowlisted function %s does not exist; remove it', hit.fn);
  END LOOP;

  FOR hit IN
    SELECT pol.tablename, pol.policyname, c.call
    FROM pg_catalog.pg_policies pol
    CROSS JOIN LATERAL pg_catalog.regexp_matches(
      coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, ''),
      '(user_workspace_ids|user_has_permission)\(([^,)]*\)?)', 'g'
    ) AS m(parts)
    CROSS JOIN LATERAL (SELECT m.parts[1] || '(' || m.parts[2]) AS c(call)
    WHERE pol.schemaname = 'public'
      AND m.parts[2] <> 'auth.uid()'
    ORDER BY 1, 2
  LOOP
    problems := problems || format('policy %s on %s calls %s with a user id other than '
      'auth.uid()', hit.policyname, hit.tablename, hit.call);
  END LOOP;

  FOR hit IN
    SELECT r.role, s.tbl, s.col
    FROM (VALUES
      ('provider_api_keys', 'encrypted_key'),
      ('provider_api_keys', 'key_iv'),
      ('slack_connections', 'incoming_webhook_url'),
      ('slack_connections', 'encrypted_webhook_url'),
      ('slack_connections', 'webhook_iv'),
      ('slack_connections', 'bot_token_encrypted'),
      ('slack_connections', 'bot_token_iv')
    ) AS s(tbl, col)
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    WHERE pg_catalog.has_column_privilege(r.role, format('public.%I', s.tbl), s.col, 'SELECT')
    ORDER BY 2, 3, 1
  LOOP
    problems := problems || format('%s can SELECT secret column %s.%s', hit.role, hit.tbl,
      hit.col);
  END LOOP;

  IF pg_catalog.cardinality(problems) > 0 THEN
    RAISE EXCEPTION E'% grant problem(s):\n  %', pg_catalog.cardinality(problems),
      pg_catalog.array_to_string(problems, E'\n  ');
  END IF;
  RAISE NOTICE 'definer grants: % allowlisted functions, no unreviewed anon or authenticated access',
    (SELECT count(*) FROM definer_allowlist);
END;
$check$;
