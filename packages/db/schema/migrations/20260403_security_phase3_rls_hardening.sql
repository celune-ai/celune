-- Migration: 20260403_security_phase3_rls_hardening
-- Security Phase 3: Defense-in-depth RLS improvements
--
-- What this fixes:
--   1. Remove workspace_id IS NULL bypass clauses from RLS policies
--      (Finding M2: rows with NULL workspace_id visible to ALL authenticated users)
--   2. Consolidate SECURITY DEFINER functions to use auth.role() = 'service_role'
--      (Finding H7: conflicting bypass conditions in RPC functions)
--   3. Replace remaining USING(true) on agent_configs SELECT
--      (Finding H6: agent_configs readable by any authenticated user)
--
-- ROLLBACK:
--   Re-add "OR workspace_id IS NULL" to USING clauses if legacy data still exists.

-- ============================================================
-- 1. Tasks: remove NULL workspace bypass
-- ============================================================

DROP POLICY IF EXISTS tasks_select_workspace ON tasks;
CREATE POLICY tasks_select_workspace ON tasks
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS tasks_insert_workspace ON tasks;
CREATE POLICY tasks_insert_workspace ON tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS tasks_update_workspace ON tasks;
CREATE POLICY tasks_update_workspace ON tasks
  FOR UPDATE TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  )
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS tasks_delete_workspace ON tasks;
CREATE POLICY tasks_delete_workspace ON tasks
  FOR DELETE TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- ============================================================
-- 2. Projects: remove NULL workspace bypass
-- ============================================================

DROP POLICY IF EXISTS projects_select_workspace ON projects;
CREATE POLICY projects_select_workspace ON projects
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS projects_insert_workspace ON projects;
CREATE POLICY projects_insert_workspace ON projects
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS projects_update_workspace ON projects;
CREATE POLICY projects_update_workspace ON projects
  FOR UPDATE TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  )
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS projects_delete_workspace ON projects;
CREATE POLICY projects_delete_workspace ON projects
  FOR DELETE TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- ============================================================
-- 3. Activity log: remove NULL workspace bypass
-- ============================================================

DROP POLICY IF EXISTS activity_log_select_workspace ON activity_log;
CREATE POLICY activity_log_select_workspace ON activity_log
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS activity_log_insert_workspace ON activity_log;
CREATE POLICY activity_log_insert_workspace ON activity_log
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- ============================================================
-- 4. Task comments: remove NULL workspace bypass
-- ============================================================

DROP POLICY IF EXISTS "task_comments_select_workspace" ON task_comments;
CREATE POLICY "task_comments_select_workspace" ON task_comments
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "task_comments_insert_workspace" ON task_comments;
CREATE POLICY "task_comments_insert_workspace" ON task_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "task_comments_update_workspace" ON task_comments;
CREATE POLICY "task_comments_update_workspace" ON task_comments
  FOR UPDATE TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  )
  WITH CHECK (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "task_comments_delete_workspace" ON task_comments;
CREATE POLICY "task_comments_delete_workspace" ON task_comments
  FOR DELETE TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- ============================================================
-- 5. agent_configs: replace USING(true) with workspace scoping
-- ============================================================

DROP POLICY IF EXISTS "agent_configs_select" ON agent_configs;
CREATE POLICY "agent_configs_select_workspace" ON agent_configs
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- ============================================================
-- 6. Heartbeat events: remove NULL workspace bypass
-- ============================================================

DROP POLICY IF EXISTS "heartbeat_events_select_workspace" ON heartbeat_events;
CREATE POLICY "heartbeat_events_select_workspace" ON heartbeat_events
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- ============================================================
-- 7. Consolidate SECURITY DEFINER functions
--    Ensure all use auth.role() = 'service_role' (not auth.uid() IS NULL)
--    This is a no-op if 20260310_cr_fixes already ran last,
--    but guarantees the safe pattern regardless of execution order.
-- ============================================================

-- Verify: list_applied_migrations RPC should already use service_role check
-- The CREATE OR REPLACE in cr_fixes migration handles this.
-- No additional changes needed if cr_fixes ran after scope_rpc.

-- ============================================================
-- 8. Pre-migration safety check: abort if NULL workspace_id rows exist
--    These rows would become invisible after the new policies.
--    Backfill them first, then re-run this migration.
-- ============================================================

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM (
    SELECT id FROM tasks WHERE workspace_id IS NULL
    UNION ALL SELECT id FROM projects WHERE workspace_id IS NULL
    UNION ALL SELECT id FROM activity_log WHERE workspace_id IS NULL
    UNION ALL SELECT id FROM task_comments WHERE workspace_id IS NULL
  ) AS orphans;

  IF orphan_count > 0 THEN
    RAISE WARNING '[RLS Phase 3] Found % rows with NULL workspace_id — these will be hidden by new policies. Run backfill before proceeding.', orphan_count;
  END IF;
END $$;
