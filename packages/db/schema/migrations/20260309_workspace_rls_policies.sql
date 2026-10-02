-- Migration: Add workspace_id to RLS policies for defense-in-depth
-- Tables addressed:
--   1. changelog_entries       — enable RLS + add workspace policies
--   2. workspace_github_tokens — enable RLS + add workspace policies
--   3. claude_usage            — add workspace_id check to existing policies
--   4. notification_preferences — add workspace_id check to existing policies
--   5. support_tickets         — add workspace_id check to existing policies
--   6. user_preferences        — add workspace_id check to existing policies
--   7. project_groups          — add workspace_id check to existing org-based policies
--   8. agent_memory            — add workspace_id check to DELETE/UPDATE policies
--   9. task_comments           — add workspace_id check to DELETE/UPDATE policies
--
-- Pattern: workspace_id IS NULL (legacy rows) OR workspace_id IN user_workspace_ids(auth.uid())
-- Service role bypasses RLS automatically.

-- ============================================================
-- 1. changelog_entries — enable RLS, add policies
-- ============================================================
ALTER TABLE changelog_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "changelog_entries_select_workspace" ON changelog_entries
  FOR SELECT USING (
    (workspace_id IS NULL)
    OR (workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

CREATE POLICY "changelog_entries_insert_workspace" ON changelog_entries
  FOR INSERT WITH CHECK (
    (workspace_id IS NULL)
    OR (workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

CREATE POLICY "changelog_entries_update_workspace" ON changelog_entries
  FOR UPDATE USING (
    (workspace_id IS NULL)
    OR (workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  ) WITH CHECK (
    (workspace_id IS NULL)
    OR (workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

CREATE POLICY "changelog_entries_delete_workspace" ON changelog_entries
  FOR DELETE USING (
    (workspace_id IS NULL)
    OR (workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

-- Service role bypass for changelog_entries
CREATE POLICY "changelog_entries_service_all" ON changelog_entries
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 2. workspace_github_tokens — enable RLS, add policies
--    Sensitive table (contains tokens), restrict tightly
-- ============================================================
ALTER TABLE workspace_github_tokens ENABLE ROW LEVEL SECURITY;

-- Authenticated users can only see tokens for their workspaces
CREATE POLICY "workspace_github_tokens_select_workspace" ON workspace_github_tokens
  FOR SELECT USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

CREATE POLICY "workspace_github_tokens_insert_workspace" ON workspace_github_tokens
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

CREATE POLICY "workspace_github_tokens_update_workspace" ON workspace_github_tokens
  FOR UPDATE USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  ) WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

CREATE POLICY "workspace_github_tokens_delete_workspace" ON workspace_github_tokens
  FOR DELETE USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- Service role bypass for workspace_github_tokens
CREATE POLICY "workspace_github_tokens_service_all" ON workspace_github_tokens
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 3. claude_usage — add workspace_id check
--    Current policies only check user_id/is_owner()
-- ============================================================
DROP POLICY IF EXISTS "claude_usage_select_user" ON claude_usage;
CREATE POLICY "claude_usage_select_user" ON claude_usage
  FOR SELECT USING (
    (auth.uid() = user_id OR is_owner())
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "claude_usage_update_user" ON claude_usage;
CREATE POLICY "claude_usage_update_user" ON claude_usage
  FOR UPDATE USING (
    (auth.uid() = user_id OR is_owner())
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "claude_usage_delete_user" ON claude_usage;
CREATE POLICY "claude_usage_delete_user" ON claude_usage
  FOR DELETE USING (
    (auth.uid() = user_id OR is_owner())
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

-- ============================================================
-- 4. notification_preferences — add workspace_id check
--    Current policies only check user_id
-- ============================================================
DROP POLICY IF EXISTS "Users can view own notification preferences" ON notification_preferences;
CREATE POLICY "Users can view own notification preferences" ON notification_preferences
  FOR SELECT USING (
    auth.uid() = user_id
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "Users can create own notification preferences" ON notification_preferences;
CREATE POLICY "Users can create own notification preferences" ON notification_preferences
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "Users can update own notification preferences" ON notification_preferences;
CREATE POLICY "Users can update own notification preferences" ON notification_preferences
  FOR UPDATE USING (
    auth.uid() = user_id
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "Users can delete own notification preferences" ON notification_preferences;
CREATE POLICY "Users can delete own notification preferences" ON notification_preferences
  FOR DELETE USING (
    auth.uid() = user_id
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

-- ============================================================
-- 5. support_tickets — add workspace_id check
--    Current policies only check user_id
-- ============================================================
DROP POLICY IF EXISTS "Users can view own tickets" ON support_tickets;
CREATE POLICY "Users can view own tickets" ON support_tickets
  FOR SELECT USING (
    auth.uid() = user_id
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "Users can create tickets" ON support_tickets;
CREATE POLICY "Users can create tickets" ON support_tickets
  FOR INSERT WITH CHECK (
    (auth.uid() = user_id OR user_id IS NULL)
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

-- ============================================================
-- 6. user_preferences — add workspace_id check
--    Current policies only check user_id
-- ============================================================
DROP POLICY IF EXISTS "Users can manage own preferences" ON user_preferences;
CREATE POLICY "Users can manage own preferences" ON user_preferences
  FOR ALL USING (
    user_id = auth.uid()
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  ) WITH CHECK (
    user_id = auth.uid()
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

-- ============================================================
-- 7. project_groups — add workspace_id check alongside org_id
-- ============================================================
DROP POLICY IF EXISTS "project_groups_select_org" ON project_groups;
CREATE POLICY "project_groups_select_org" ON project_groups
  FOR SELECT USING (
    org_id IN (SELECT user_org_ids())
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "project_groups_insert_org" ON project_groups;
CREATE POLICY "project_groups_insert_org" ON project_groups
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "project_groups_update_org" ON project_groups;
CREATE POLICY "project_groups_update_org" ON project_groups
  FOR UPDATE USING (
    org_id IN (SELECT user_org_ids())
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  ) WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "project_groups_delete_org" ON project_groups;
CREATE POLICY "project_groups_delete_org" ON project_groups
  FOR DELETE USING (
    org_id IN (SELECT user_admin_org_ids())
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

-- ============================================================
-- 8. agent_memory — add workspace_id check to DELETE/UPDATE
--    SELECT/INSERT already have workspace_id checks
-- ============================================================
DROP POLICY IF EXISTS "agent_memory_delete_multitenant" ON agent_memory;
CREATE POLICY "agent_memory_delete_multitenant" ON agent_memory
  FOR DELETE USING (
    user_id = auth.uid()
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "agent_memory_update_multitenant" ON agent_memory;
CREATE POLICY "agent_memory_update_multitenant" ON agent_memory
  FOR UPDATE USING (
    user_id = auth.uid()
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  ) WITH CHECK (
    user_id = auth.uid()
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

-- ============================================================
-- 9. task_comments — add workspace_id check to DELETE/UPDATE
--    SELECT/INSERT already have workspace_id checks
-- ============================================================
DROP POLICY IF EXISTS "task_comments_delete_org" ON task_comments;
CREATE POLICY "task_comments_delete_org" ON task_comments
  FOR DELETE USING (
    user_id = auth.uid()
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "task_comments_update_org" ON task_comments;
CREATE POLICY "task_comments_update_org" ON task_comments
  FOR UPDATE USING (
    user_id = auth.uid()
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  ) WITH CHECK (
    user_id = auth.uid()
    AND (workspace_id IS NULL OR workspace_id IN (SELECT user_workspace_ids(auth.uid())))
  );

-- End of migration
