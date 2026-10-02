-- 20260310_scope_rpc_to_caller_org.sql
-- Security fix: scope get_users_by_ids, get_pending_invitations, and
-- get_invitation_user to only return users who share an org with the caller.
-- Previously these SECURITY DEFINER functions exposed auth.users data for
-- any UUID without membership checks — an authenticated user could enumerate
-- emails by guessing UUIDs.
--
-- Fix: JOIN against org_memberships / org_members so only co-members of the
-- caller's org(s) are returned. service_role calls bypass the filter via
-- auth.uid() being NULL (handled with a short-circuit).

-- ============================================================
-- get_users_by_ids(user_ids uuid[])
-- Now only returns users who share at least one org with the caller.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_users_by_ids(user_ids uuid[])
RETURNS TABLE (
  id           uuid,
  email        text,
  display_name text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT
    u.id,
    u.email,
    (u.raw_user_meta_data->>'display_name')::text AS display_name
  FROM auth.users u
  WHERE u.id = ANY(user_ids)
    AND (
      -- service_role bypass: auth.uid() is NULL for service_role calls
      auth.uid() IS NULL
      OR EXISTS (
        -- Legacy path: caller and target share an org via org_memberships
        SELECT 1
        FROM org_memberships caller_om
        JOIN org_memberships target_om ON caller_om.org_id = target_om.org_id
        WHERE caller_om.user_id = auth.uid()
          AND target_om.user_id = u.id
      )
      OR EXISTS (
        -- RBAC v2 path: caller and target share an org via org_members
        SELECT 1
        FROM org_members caller_om
        JOIN org_members target_om ON caller_om.org_id = target_om.org_id
        WHERE caller_om.user_id = auth.uid()
          AND caller_om.is_active = true
          AND target_om.user_id = u.id
          AND target_om.is_active = true
      )
    );
$$;

-- Permissions unchanged
REVOKE ALL ON FUNCTION public.get_users_by_ids(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_users_by_ids(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_users_by_ids(uuid[]) TO service_role;

-- ============================================================
-- get_pending_invitations()
-- Now only returns pending invitations for users in the caller's org(s).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_pending_invitations()
RETURNS TABLE (
  id           uuid,
  email        text,
  invited_at   timestamptz,
  created_at   timestamptz,
  invited_role text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT
    u.id,
    u.email,
    u.invited_at,
    u.created_at,
    (u.raw_user_meta_data->>'invited_role')::text AS invited_role
  FROM auth.users u
  WHERE u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND (
      -- service_role bypass
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM org_memberships om
        WHERE om.user_id = u.id
          AND om.org_id IN (
            SELECT org_id FROM org_memberships WHERE user_id = auth.uid()
          )
      )
      OR EXISTS (
        SELECT 1 FROM org_members om
        WHERE om.user_id = u.id
          AND om.is_active = true
          AND om.org_id IN (
            SELECT org_id FROM org_members WHERE user_id = auth.uid() AND is_active = true
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_pending_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations() TO service_role;

-- ============================================================
-- get_invitation_user(p_user_id uuid)
-- Now only returns the invitation if the target user is in the caller's org.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_invitation_user(p_user_id uuid)
RETURNS TABLE (
  id             uuid,
  email          text,
  invited_at     timestamptz,
  confirmed_at   timestamptz,
  invited_role   text,
  banned_until   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    u.id,
    u.email,
    u.invited_at,
    u.email_confirmed_at   AS confirmed_at,
    (u.raw_user_meta_data->>'invited_role')::text AS invited_role,
    u.banned_until
  FROM auth.users u
  WHERE u.id = p_user_id
    AND (
      -- service_role bypass
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM org_memberships om
        WHERE om.user_id = u.id
          AND om.org_id IN (
            SELECT org_id FROM org_memberships WHERE user_id = auth.uid()
          )
      )
      OR EXISTS (
        SELECT 1 FROM org_members om
        WHERE om.user_id = u.id
          AND om.is_active = true
          AND om.org_id IN (
            SELECT org_id FROM org_members WHERE user_id = auth.uid() AND is_active = true
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_invitation_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_user(uuid) TO service_role;
