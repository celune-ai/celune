-- user_workspace_ids(uuid) and user_has_permission(uuid, uuid, text) are SECURITY DEFINER RLS
-- helpers that take a user id from the caller. anon and authenticated can execute them (RLS
-- policies need that), so any caller could pass another user's id through PostgREST and read
-- that user's workspace memberships and permissions.
--
-- Both now answer only for the caller when the request runs as anon or authenticated: a user id
-- that differs from auth.uid() gets no workspaces and no permission. service_role requests and
-- direct database connections (migrations, scripts) keep the unrestricted answer. The check reads
-- the role setting, which PostgREST sets per request and which a SECURITY DEFINER call leaves
-- unchanged. Bodies are otherwise identical to 20260306_rbac_v2_rls_permission_functions.sql;
-- signatures, owners, and grants are unchanged.
--
-- Policy behavior is unchanged: every RLS policy that calls either function passes auth.uid()
-- as the user id (packages/db/scripts/check-definer-grants.sql fails CI if one stops doing so).
-- The 55 policies on 19 tables, [P] marking user_has_permission, the rest user_workspace_ids:
--   activity_log: activity_log_delete_workspace; activity_log_insert_workspace;
--     activity_log_select_workspace; activity_log_update_workspace
--   agent_configs: agent_configs_select_workspace
--   agent_memory: agent_memory_delete_multitenant; agent_memory_insert_multitenant;
--     agent_memory_select_multitenant; agent_memory_update_multitenant
--   changelog_entries: changelog_entries_delete_workspace; changelog_entries_insert_workspace;
--     changelog_entries_select_workspace; changelog_entries_update_workspace
--   claude_usage: claude_usage_delete_user; claude_usage_select_user; claude_usage_update_user
--   heartbeat_events: heartbeat_events_select_workspace
--   knowledge_items: knowledge_items_select_workspace
--   knowledge_syncs: knowledge_syncs_select_workspace
--   notification_preferences: Users can create own notification preferences; Users can delete
--     own notification preferences; Users can update own notification preferences; Users can
--     view own notification preferences
--   portfolio_passwords: portfolio_passwords_select_workspace
--   project_groups: project_groups_delete_org; project_groups_insert_org;
--     project_groups_select_org; project_groups_update_org
--   projects: projects_delete_workspace; projects_insert_workspace; projects_select_workspace;
--     projects_update_workspace
--   slack_connections: Workspace admins can manage slack connections (both functions);
--     Workspace members can view slack connections
--   support_tickets: Users can create tickets; Users can view own tickets
--   task_comments: task_comments_delete_org; task_comments_delete_workspace;
--     task_comments_insert_workspace; task_comments_select_workspace; task_comments_update_org;
--     task_comments_update_workspace
--   tasks: tasks_delete_workspace; tasks_insert_workspace; tasks_select_workspace;
--     tasks_update_workspace
--   user_preferences: Users can manage own preferences
--   workspace_github_tokens: workspace_github_tokens_delete_workspace;
--     workspace_github_tokens_insert_workspace; workspace_github_tokens_select_workspace;
--     workspace_github_tokens_update_workspace
--   workspace_memberships: workspace_memberships_delete [P]; workspace_memberships_insert;
--     workspace_memberships_select; workspace_memberships_update [P]
--
-- No application code calls either function directly.

CREATE OR REPLACE FUNCTION public.user_workspace_ids(uid uuid)
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT ids.id
  FROM (
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
    WHERE wm.user_id = uid
  ) AS ids(id)
  -- User roles may only ask about themselves.
  WHERE uid = auth.uid()
     OR coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated');
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission(
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
  -- User roles may only ask about themselves.
  IF p_user_id IS DISTINCT FROM auth.uid()
     AND coalesce(current_setting('role', true), 'none') IN ('anon', 'authenticated') THEN
    RETURN false;
  END IF;

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
