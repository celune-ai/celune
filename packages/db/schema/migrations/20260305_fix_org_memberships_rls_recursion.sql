-- Fix infinite recursion in org_memberships RLS policies
-- The SELECT policy was self-referencing: it queried org_memberships to check
-- if you could read org_memberships, causing PostgreSQL error 42P17.
-- This broke any RLS policy using user_org_ids() (e.g. activity_log).

-- SELECT: you can see your own memberships (no self-reference needed)
DROP POLICY IF EXISTS org_memberships_select_member ON org_memberships;
CREATE POLICY org_memberships_select_member ON org_memberships
  FOR SELECT
  USING (user_id = auth.uid());

-- INSERT: admins/owners can add members (use SECURITY DEFINER function)
DROP POLICY IF EXISTS org_memberships_insert_admin ON org_memberships;
CREATE POLICY org_memberships_insert_admin ON org_memberships
  FOR INSERT
  WITH CHECK (org_id IN (SELECT user_admin_org_ids()));

-- UPDATE: admins/owners can update members
DROP POLICY IF EXISTS org_memberships_update_admin ON org_memberships;
CREATE POLICY org_memberships_update_admin ON org_memberships
  FOR UPDATE
  USING (org_id IN (SELECT user_admin_org_ids()))
  WITH CHECK (org_id IN (SELECT user_admin_org_ids()));

-- DELETE: you can remove yourself, or admins/owners can remove others
DROP POLICY IF EXISTS org_memberships_delete_admin ON org_memberships;
CREATE POLICY org_memberships_delete_admin ON org_memberships
  FOR DELETE
  USING (user_id = auth.uid() OR org_id IN (SELECT user_admin_org_ids()));

-- Fix activity_log INSERT policy: allow NULL workspace_id for system-level activity
DROP POLICY IF EXISTS activity_log_insert_org ON activity_log;
CREATE POLICY activity_log_insert_org ON activity_log
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IS NULL
    OR workspace_id IN (SELECT w.id FROM workspaces w WHERE w.org_id IN (SELECT user_org_ids()))
  );
