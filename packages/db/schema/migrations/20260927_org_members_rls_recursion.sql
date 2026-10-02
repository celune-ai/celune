-- Migration 20260927_org_members_rls_recursion: fixes org_members_select_org_staff.
--
-- The policy (hand-made on the hosted project, copied in 20260926_reconstruct_hosted_drift.sql,
-- and first written in 20260306_rbac_v2_org_members.sql) queries org_members inside its own
-- policy. Postgres raises "infinite recursion detected in policy" for every non-service read.
-- A SECURITY DEFINER helper reads the caller's staff orgs without re-entering RLS. The rule is
-- unchanged: active owners and members with the admin role.
--
-- This is a real change on the hosted project. Apply it there with migrate; do not backfill it.

CREATE OR REPLACE FUNCTION public.org_staff_org_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT om.org_id
  FROM org_members om
  JOIN roles r ON r.id = om.role_id
  WHERE om.user_id = auth.uid()
    AND om.is_active = true
    AND (om.is_owner = true OR r.slug = 'admin');
$$;

REVOKE ALL ON FUNCTION public.org_staff_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_staff_org_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS org_members_select_org_staff ON org_members;
CREATE POLICY org_members_select_org_staff ON org_members
  FOR SELECT USING (org_id IN (SELECT public.org_staff_org_ids()));

-- Rollback: restore the previous policy body from 20260926_reconstruct_hosted_drift.sql,
-- then DROP FUNCTION public.org_staff_org_ids();
