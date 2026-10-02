-- Migration: 028-fix-null-workspace-rls
-- Fix RLS policies so rows with NULL workspace_id are visible to authenticated users.
-- Adds OR workspace_id IS NULL to USING clauses on SELECT, UPDATE, DELETE policies
-- for activity_log, task_comments, agent_status, agent_configs.

-- ============================================================
-- activity_log
-- ============================================================

DROP POLICY IF EXISTS activity_log_select_org ON activity_log;
CREATE POLICY activity_log_select_org ON activity_log
  FOR SELECT
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      WHERE w.org_id IN (SELECT user_org_ids())
    )
  );

DROP POLICY IF EXISTS activity_log_update_org ON activity_log;
CREATE POLICY activity_log_update_org ON activity_log
  FOR UPDATE
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      WHERE w.org_id IN (SELECT user_org_ids())
    )
  );

DROP POLICY IF EXISTS activity_log_delete_org ON activity_log;
CREATE POLICY activity_log_delete_org ON activity_log
  FOR DELETE
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      WHERE w.org_id IN (SELECT user_admin_org_ids())
    )
  );

-- ============================================================
-- agent_configs
-- ============================================================

DROP POLICY IF EXISTS agent_configs_select_org ON agent_configs;
CREATE POLICY agent_configs_select_org ON agent_configs
  FOR SELECT
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      WHERE w.org_id IN (SELECT user_org_ids())
    )
  );

DROP POLICY IF EXISTS agent_configs_update_org ON agent_configs;
CREATE POLICY agent_configs_update_org ON agent_configs
  FOR UPDATE
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      WHERE w.org_id IN (SELECT user_org_ids())
    )
  );

DROP POLICY IF EXISTS agent_configs_delete_org ON agent_configs;
CREATE POLICY agent_configs_delete_org ON agent_configs
  FOR DELETE
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      WHERE w.org_id IN (SELECT user_admin_org_ids())
    )
  );

-- ============================================================
-- agent_status
-- ============================================================

DROP POLICY IF EXISTS agent_status_select_org ON agent_status;
CREATE POLICY agent_status_select_org ON agent_status
  FOR SELECT
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      WHERE w.org_id IN (SELECT user_org_ids())
    )
  );

DROP POLICY IF EXISTS agent_status_update_org ON agent_status;
CREATE POLICY agent_status_update_org ON agent_status
  FOR UPDATE
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      WHERE w.org_id IN (SELECT user_org_ids())
    )
  );

DROP POLICY IF EXISTS agent_status_delete_org ON agent_status;
CREATE POLICY agent_status_delete_org ON agent_status
  FOR DELETE
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      WHERE w.org_id IN (SELECT user_admin_org_ids())
    )
  );

-- ============================================================
-- task_comments
-- (UPDATE/DELETE already use user_id = auth.uid(), only SELECT needs fix)
-- ============================================================

DROP POLICY IF EXISTS task_comments_select_org ON task_comments;
CREATE POLICY task_comments_select_org ON task_comments
  FOR SELECT
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      WHERE w.org_id IN (SELECT user_org_ids())
    )
  );
