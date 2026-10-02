-- RBAC v2: Permission-based RLS functions
-- Creates user_has_permission() and updates helper functions to use
-- org_members + workspace_memberships in addition to user_roles.

-- ============================================
-- 1. user_has_permission() — SECURITY DEFINER
-- ============================================
-- Core function: checks if a user has a specific permission key
-- in a given workspace context.
-- Resolution order matches resolvePermissions() in TypeScript:
--   1. Platform admin (user_roles.role = 'owner') → always true
--   2. Org owner (org_members.is_owner) → always true
--   3. Org role → check role_permissions
--   4. Workspace role → check role_permissions
--   5. Default deny

CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id uuid,
  p_workspace_id uuid,
  p_permission_key text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_role_id uuid;
  v_has_permission boolean;
BEGIN
  -- Step 1: Platform admin (legacy user_roles bridge)
  IF EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = p_user_id AND role = 'owner' AND is_active = true
  ) THEN
    RETURN true;
  END IF;

  -- Step 2: Resolve workspace → org_id
  SELECT org_id INTO v_org_id
  FROM workspaces
  WHERE id = p_workspace_id;

  -- Step 3: Org membership
  IF v_org_id IS NOT NULL THEN
    -- Check if org owner
    IF EXISTS (
      SELECT 1 FROM org_members
      WHERE user_id = p_user_id AND org_id = v_org_id
        AND is_owner = true AND is_active = true
    ) THEN
      RETURN true;
    END IF;

    -- Check org-level role permissions
    SELECT om.role_id INTO v_role_id
    FROM org_members om
    WHERE om.user_id = p_user_id AND om.org_id = v_org_id AND om.is_active = true;

    IF v_role_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = v_role_id AND p.key = p_permission_key
      ) INTO v_has_permission;
      IF v_has_permission THEN RETURN true; END IF;
    END IF;
  END IF;

  -- Step 4: Workspace-level role
  SELECT wm.role_id INTO v_role_id
  FROM workspace_memberships wm
  WHERE wm.user_id = p_user_id AND wm.workspace_id = p_workspace_id;

  IF v_role_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = v_role_id AND p.key = p_permission_key
    ) INTO v_has_permission;
    IF v_has_permission THEN RETURN true; END IF;
  END IF;

  -- Step 5: Default deny
  RETURN false;
END;
$$;


-- ============================================
-- 2. Update is_owner() to also check org_members
-- ============================================

CREATE OR REPLACE FUNCTION is_owner()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'owner' AND is_active = true
  ) OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = auth.uid() AND is_owner = true AND is_active = true
  );
$$;


-- ============================================
-- 3. Update user_workspace_ids() to use org_members
-- ============================================
-- Now checks both legacy user_roles AND new org_members for admin access.

CREATE OR REPLACE FUNCTION user_workspace_ids(uid uuid)
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  -- Platform admin via user_roles: all workspaces in their org(s)
  SELECT w.id
  FROM workspaces w
  WHERE w.org_id IN (
    SELECT ur.org_id
    FROM user_roles ur
    WHERE ur.user_id = uid
      AND ur.role IN ('owner', 'admin')
      AND ur.is_active = true
  )
  UNION
  -- Org owner/admin via org_members: all workspaces in their org(s)
  SELECT w.id
  FROM workspaces w
  WHERE w.org_id IN (
    SELECT om.org_id
    FROM org_members om
    WHERE om.user_id = uid
      AND om.is_active = true
      AND (om.is_owner = true OR EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = om.role_id AND p.key = 'settings:manage'
      ))
  )
  UNION
  -- Explicit workspace membership
  SELECT wm.workspace_id
  FROM workspace_memberships wm
  WHERE wm.user_id = uid;
$$;


-- ============================================
-- 4. Update user_admin_org_ids() to also check org_members
-- ============================================

CREATE OR REPLACE FUNCTION user_admin_org_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  -- Legacy path
  SELECT org_id FROM org_memberships
  WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  UNION
  -- RBAC v2 path: org owners
  SELECT org_id FROM org_members
  WHERE user_id = auth.uid() AND is_owner = true AND is_active = true
  UNION
  -- RBAC v2 path: org members with settings:manage permission
  SELECT om.org_id FROM org_members om
  WHERE om.user_id = auth.uid()
    AND om.is_active = true
    AND EXISTS (
      SELECT 1 FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = om.role_id AND p.key = 'settings:manage'
    );
$$;


-- ============================================
-- 5. Update workspace_memberships RLS policies
-- ============================================
-- Add org_members check alongside existing user_roles check.

DROP POLICY IF EXISTS "workspace_memberships_select" ON workspace_memberships;
CREATE POLICY "workspace_memberships_select" ON workspace_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "workspace_memberships_insert" ON workspace_memberships;
CREATE POLICY "workspace_memberships_insert" ON workspace_memberships
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "workspace_memberships_update" ON workspace_memberships;
CREATE POLICY "workspace_memberships_update" ON workspace_memberships
  FOR UPDATE USING (
    auth.role() = 'service_role'
    OR user_has_permission(auth.uid(), workspace_id, 'users:manage')
  );

DROP POLICY IF EXISTS "workspace_memberships_delete" ON workspace_memberships;
CREATE POLICY "workspace_memberships_delete" ON workspace_memberships
  FOR DELETE USING (
    auth.role() = 'service_role'
    OR user_has_permission(auth.uid(), workspace_id, 'users:manage')
  );
