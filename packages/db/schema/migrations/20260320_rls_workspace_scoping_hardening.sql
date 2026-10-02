-- Migration: 20260320_rls_workspace_scoping_hardening
-- Project: Security & Enterprise Hardening (bd358ab6)
-- Task: Fix RLS policies — replace USING(true) with tenant scoping (cf431d31)
--
-- What this fixes:
--   1. task_comments: upgrade from user_id scoping to workspace scoping
--      (user_id scoping is too restrictive for multi-user workspaces)
--   2. cron_jobs: restrict from USING(true) to service_role only
--      (internal admin table, no reason for authenticated users to access)
--
-- Already fixed by prior migrations:
--   - tasks, projects, activity_log → 029 (user_workspace_ids)
--   - agent_configs, agent_status → 20260308 (workspace scoping)
--   - agent_memory → 20260307 (multitenant RLS)
--   - claude_usage → 20260319 (user_id scoping + anon removed)
--   - project_groups → 20260305 (org_id scoping)
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS "task_comments_select_workspace" ON task_comments;
--   DROP POLICY IF EXISTS "task_comments_insert_workspace" ON task_comments;
--   DROP POLICY IF EXISTS "task_comments_update_workspace" ON task_comments;
--   DROP POLICY IF EXISTS "task_comments_delete_workspace" ON task_comments;
--   CREATE POLICY "task_comments_select_user" ON task_comments FOR SELECT TO authenticated USING (auth.uid() = user_id);
--   CREATE POLICY "task_comments_insert_user" ON task_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
--   CREATE POLICY "task_comments_update_user" ON task_comments FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
--   CREATE POLICY "task_comments_delete_user" ON task_comments FOR DELETE TO authenticated USING (auth.uid() = user_id);
--   DROP POLICY IF EXISTS "cron_jobs_deny_authenticated" ON cron_jobs;
--   CREATE POLICY "cron_jobs_select" ON cron_jobs FOR SELECT TO authenticated USING (true);
--   CREATE POLICY "cron_jobs_insert" ON cron_jobs FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
--   CREATE POLICY "cron_jobs_update" ON cron_jobs FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- 1. task_comments: workspace-scoped RLS
-- ============================================================

-- Drop old user_id-based policies (from migration 023)
DROP POLICY IF EXISTS "task_comments_select" ON task_comments;
DROP POLICY IF EXISTS "task_comments_insert" ON task_comments;
DROP POLICY IF EXISTS "task_comments_update" ON task_comments;
DROP POLICY IF EXISTS "task_comments_delete" ON task_comments;
DROP POLICY IF EXISTS "task_comments_select_user" ON task_comments;
DROP POLICY IF EXISTS "task_comments_insert_user" ON task_comments;
DROP POLICY IF EXISTS "task_comments_update_user" ON task_comments;
DROP POLICY IF EXISTS "task_comments_delete_user" ON task_comments;

-- New workspace-scoped policies using user_workspace_ids()
-- All workspace members can read comments on tasks in their workspace
CREATE POLICY "task_comments_select_workspace" ON task_comments
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- Insert: workspace members can add comments to their workspace
CREATE POLICY "task_comments_insert_workspace" ON task_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- Update: workspace members can edit comments in their workspace
CREATE POLICY "task_comments_update_workspace" ON task_comments
  FOR UPDATE TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  )
  WITH CHECK (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- Delete: workspace members can delete comments in their workspace
CREATE POLICY "task_comments_delete_workspace" ON task_comments
  FOR DELETE TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- ============================================================
-- 2. cron_jobs: restrict to service_role only
-- ============================================================

-- Drop old permissive policies
DROP POLICY IF EXISTS "cron_jobs_select" ON cron_jobs;
DROP POLICY IF EXISTS "cron_jobs_insert" ON cron_jobs;
DROP POLICY IF EXISTS "cron_jobs_update" ON cron_jobs;

-- Deny all access for authenticated users (service_role bypasses RLS)
CREATE POLICY "cron_jobs_deny_authenticated" ON cron_jobs
  FOR ALL TO authenticated
  USING (false);
