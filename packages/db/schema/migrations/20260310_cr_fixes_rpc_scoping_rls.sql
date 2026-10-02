-- Code review fixes for PR #13:
-- 1. Replace auth.uid() IS NULL with auth.role() = 'service_role' in RPCs
--    (auth.uid() IS NULL could match unauthenticated requests, not just service_role)
-- 2. Scope org_permission_overrides SELECT policy to org members
-- 3. Add REVOKE FROM PUBLIC on seed_org_roles()
-- 4. Add role CHECK constraint on org_permission_overrides

-- ============================================================
-- 1. Fix get_users_by_ids — use auth.role() = 'service_role'
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
      -- service_role bypass (explicit role check, not auth.uid() IS NULL)
      auth.role() = 'service_role'
      OR EXISTS (
        -- Legacy path: org_memberships (no is_active column).
        -- Exclude users explicitly deactivated in org_members to prevent bypass.
        SELECT 1
        FROM org_memberships caller_om
        JOIN org_memberships target_om ON caller_om.org_id = target_om.org_id
        WHERE caller_om.user_id = auth.uid()
          AND target_om.user_id = u.id
          AND NOT EXISTS (
            SELECT 1 FROM org_members deact
            WHERE deact.user_id = auth.uid()
              AND deact.org_id = caller_om.org_id
              AND deact.is_active = false
          )
      )
      OR EXISTS (
        -- RBAC v2 path: org_members with is_active enforcement
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

-- ============================================================
-- 2. Fix get_pending_invitations — use auth.role() = 'service_role'
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
      auth.role() = 'service_role'
      OR EXISTS (
        -- Legacy path with deactivation guard
        SELECT 1 FROM org_memberships om
        WHERE om.user_id = u.id
          AND om.org_id IN (
            SELECT org_id FROM org_memberships WHERE user_id = auth.uid()
          )
          AND NOT EXISTS (
            SELECT 1 FROM org_members deact
            WHERE deact.user_id = auth.uid()
              AND deact.org_id = om.org_id
              AND deact.is_active = false
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

-- ============================================================
-- 3. Fix get_invitation_user — use auth.role() = 'service_role'
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
      auth.role() = 'service_role'
      OR EXISTS (
        -- Legacy path with deactivation guard
        SELECT 1 FROM org_memberships om
        WHERE om.user_id = u.id
          AND om.org_id IN (
            SELECT org_id FROM org_memberships WHERE user_id = auth.uid()
          )
          AND NOT EXISTS (
            SELECT 1 FROM org_members deact
            WHERE deact.user_id = auth.uid()
              AND deact.org_id = om.org_id
              AND deact.is_active = false
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

-- ============================================================
-- 4. Scope org_permission_overrides SELECT to org members
-- ============================================================

-- Moved to 20260310_granular_permissions_keys.sql, which creates the table and sorts after this file.

-- ============================================================
-- 5. REVOKE PUBLIC access to seed_org_roles()
-- ============================================================

-- Moved to 20260310_org_role_seeding_trigger.sql, which creates the function and sorts after this file.

-- ============================================================
-- 6. Add role CHECK constraint on org_permission_overrides
-- ============================================================

-- Moved to 20260310_granular_permissions_keys.sql.
