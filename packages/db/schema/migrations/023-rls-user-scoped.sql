-- 023-rls-user-scoped.sql
-- P0: Rewrite RLS policies for data isolation
-- Replaces all permissive USING(true) / auth.role() policies with user-scoped
-- USING(auth.uid() = user_id) policies. After this migration, authenticated
-- users can only read and modify their own rows.
--
-- Depends on: 021-user-id-columns.sql (user_id columns), 022-backfill-user-id.sql (NOT NULL)
--
-- Policy naming convention: {table}_{operation}_user
--   e.g. projects_select_user, tasks_insert_user
--   The suffix "_user" signals that the policy is user-scoped (auth.uid() = user_id).
--
-- Service role note: Supabase service_role bypasses RLS by default — no policy
-- changes required for server-side agent/webhook operations that use createServiceClient().
--
-- ============================================================
-- ROLLBACK
-- ============================================================
-- To revert to the permissive auth.role() policies from migration 002:
--
-- -- projects
-- DROP POLICY IF EXISTS "projects_select_user" ON projects;
-- DROP POLICY IF EXISTS "projects_insert_user" ON projects;
-- DROP POLICY IF EXISTS "projects_update_user" ON projects;
-- DROP POLICY IF EXISTS "projects_delete_user" ON projects;
-- CREATE POLICY "projects_select" ON projects FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "projects_insert" ON projects FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "projects_update" ON projects FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "projects_delete" ON projects FOR DELETE TO authenticated USING (auth.role() = 'authenticated');
--
-- -- tasks
-- DROP POLICY IF EXISTS "tasks_select_user" ON tasks;
-- DROP POLICY IF EXISTS "tasks_insert_user" ON tasks;
-- DROP POLICY IF EXISTS "tasks_update_user" ON tasks;
-- DROP POLICY IF EXISTS "tasks_delete_user" ON tasks;
-- CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "tasks_delete" ON tasks FOR DELETE TO authenticated USING (auth.role() = 'authenticated');
--
-- -- project_groups
-- DROP POLICY IF EXISTS "project_groups_select_user" ON project_groups;
-- DROP POLICY IF EXISTS "project_groups_insert_user" ON project_groups;
-- DROP POLICY IF EXISTS "project_groups_update_user" ON project_groups;
-- DROP POLICY IF EXISTS "project_groups_delete_user" ON project_groups;
-- CREATE POLICY "Allow all access to project_groups" ON project_groups FOR ALL USING (true) WITH CHECK (true);
--
-- -- activity_log
-- DROP POLICY IF EXISTS "activity_log_select_user" ON activity_log;
-- DROP POLICY IF EXISTS "activity_log_insert_user" ON activity_log;
-- DROP POLICY IF EXISTS "activity_log_update_user" ON activity_log;
-- DROP POLICY IF EXISTS "activity_log_delete_user" ON activity_log;
-- CREATE POLICY "activity_log_select" ON activity_log FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "activity_log_insert" ON activity_log FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "activity_log_update" ON activity_log FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "activity_log_delete" ON activity_log FOR DELETE TO authenticated USING (auth.role() = 'authenticated');
--
-- -- task_comments
-- DROP POLICY IF EXISTS "task_comments_select_user" ON task_comments;
-- DROP POLICY IF EXISTS "task_comments_insert_user" ON task_comments;
-- DROP POLICY IF EXISTS "task_comments_update_user" ON task_comments;
-- DROP POLICY IF EXISTS "task_comments_delete_user" ON task_comments;
-- CREATE POLICY "task_comments_select" ON task_comments FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "task_comments_insert" ON task_comments FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "task_comments_update" ON task_comments FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "task_comments_delete" ON task_comments FOR DELETE TO authenticated USING (auth.role() = 'authenticated');
--
-- -- agent_status
-- DROP POLICY IF EXISTS "agent_status_select_user" ON agent_status;
-- DROP POLICY IF EXISTS "agent_status_insert_user" ON agent_status;
-- DROP POLICY IF EXISTS "agent_status_update_user" ON agent_status;
-- DROP POLICY IF EXISTS "agent_status_delete_user" ON agent_status;
-- CREATE POLICY "agent_status_select" ON agent_status FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "agent_status_insert" ON agent_status FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "agent_status_update" ON agent_status FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "agent_status_delete" ON agent_status FOR DELETE TO authenticated USING (auth.role() = 'authenticated');
--
-- -- agent_configs
-- DROP POLICY IF EXISTS "agent_configs_select_user" ON agent_configs;
-- DROP POLICY IF EXISTS "agent_configs_insert_user" ON agent_configs;
-- DROP POLICY IF EXISTS "agent_configs_update_user" ON agent_configs;
-- DROP POLICY IF EXISTS "agent_configs_delete_user" ON agent_configs;
-- CREATE POLICY "agent_configs_select" ON agent_configs FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "agent_configs_insert" ON agent_configs FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "agent_configs_update" ON agent_configs FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "agent_configs_delete" ON agent_configs FOR DELETE TO authenticated USING (auth.role() = 'authenticated');
--
-- -- agent_memory
-- DROP POLICY IF EXISTS "agent_memory_select_user" ON agent_memory;
-- DROP POLICY IF EXISTS "agent_memory_insert_user" ON agent_memory;
-- DROP POLICY IF EXISTS "agent_memory_update_user" ON agent_memory;
-- DROP POLICY IF EXISTS "agent_memory_delete_user" ON agent_memory;
-- CREATE POLICY "Service role full access on agent_memory" ON agent_memory FOR ALL TO service_role USING (true) WITH CHECK (true);
-- CREATE POLICY "Authenticated read-only on agent_memory" ON agent_memory FOR SELECT TO authenticated USING (true);
--
-- -- cron_jobs
-- DROP POLICY IF EXISTS "cron_jobs_select_user" ON cron_jobs;
-- DROP POLICY IF EXISTS "cron_jobs_insert_user" ON cron_jobs;
-- DROP POLICY IF EXISTS "cron_jobs_update_user" ON cron_jobs;
-- DROP POLICY IF EXISTS "cron_jobs_delete_user" ON cron_jobs;
-- CREATE POLICY "cron_jobs_select" ON cron_jobs FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "cron_jobs_insert" ON cron_jobs FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
-- CREATE POLICY "cron_jobs_update" ON cron_jobs FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
-- ============================================================


-- ============================================================
-- projects
-- ============================================================
DROP POLICY IF EXISTS "projects_select" ON projects;
DROP POLICY IF EXISTS "projects_insert" ON projects;
DROP POLICY IF EXISTS "projects_update" ON projects;
DROP POLICY IF EXISTS "projects_delete" ON projects;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select_user" ON projects
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "projects_insert_user" ON projects
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "projects_update_user" ON projects
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "projects_delete_user" ON projects
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ============================================================
-- tasks
-- ============================================================
DROP POLICY IF EXISTS "tasks_select" ON tasks;
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
DROP POLICY IF EXISTS "tasks_update" ON tasks;
DROP POLICY IF EXISTS "tasks_delete" ON tasks;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select_user" ON tasks
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "tasks_insert_user" ON tasks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tasks_update_user" ON tasks
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tasks_delete_user" ON tasks
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ============================================================
-- project_groups
-- RLS was enabled in migration 020 with a single FOR ALL USING(true) policy.
-- ============================================================
DROP POLICY IF EXISTS "Allow all access to project_groups" ON project_groups;

ALTER TABLE project_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_groups_select_user" ON project_groups
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "project_groups_insert_user" ON project_groups
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "project_groups_update_user" ON project_groups
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "project_groups_delete_user" ON project_groups
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ============================================================
-- activity_log
-- ============================================================
DROP POLICY IF EXISTS "activity_log_select" ON activity_log;
DROP POLICY IF EXISTS "activity_log_insert" ON activity_log;
DROP POLICY IF EXISTS "activity_log_update" ON activity_log;
DROP POLICY IF EXISTS "activity_log_delete" ON activity_log;

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log_select_user" ON activity_log
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "activity_log_insert_user" ON activity_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "activity_log_update_user" ON activity_log
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "activity_log_delete_user" ON activity_log
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ============================================================
-- task_comments
-- ============================================================
DROP POLICY IF EXISTS "task_comments_select" ON task_comments;
DROP POLICY IF EXISTS "task_comments_insert" ON task_comments;
DROP POLICY IF EXISTS "task_comments_update" ON task_comments;
DROP POLICY IF EXISTS "task_comments_delete" ON task_comments;

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_comments_select_user" ON task_comments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "task_comments_insert_user" ON task_comments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "task_comments_update_user" ON task_comments
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "task_comments_delete_user" ON task_comments
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ============================================================
-- agent_status
-- ============================================================
DROP POLICY IF EXISTS "agent_status_select" ON agent_status;
DROP POLICY IF EXISTS "agent_status_insert" ON agent_status;
DROP POLICY IF EXISTS "agent_status_update" ON agent_status;
DROP POLICY IF EXISTS "agent_status_delete" ON agent_status;

ALTER TABLE agent_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_status_select_user" ON agent_status
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "agent_status_insert_user" ON agent_status
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_status_update_user" ON agent_status
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_status_delete_user" ON agent_status
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ============================================================
-- agent_configs
-- ============================================================
DROP POLICY IF EXISTS "agent_configs_select" ON agent_configs;
DROP POLICY IF EXISTS "agent_configs_insert" ON agent_configs;
DROP POLICY IF EXISTS "agent_configs_update" ON agent_configs;
DROP POLICY IF EXISTS "agent_configs_delete" ON agent_configs;

ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_configs_select_user" ON agent_configs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "agent_configs_insert_user" ON agent_configs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_configs_update_user" ON agent_configs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_configs_delete_user" ON agent_configs
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ============================================================
-- agent_memory
-- Migration 007 created a service_role full-access policy and an
-- authenticated read-only policy. Both are replaced here with
-- user-scoped per-operation policies for authenticated role.
-- The service_role bypass is preserved via Supabase's built-in
-- service_role RLS bypass — no explicit policy needed.
-- ============================================================
DROP POLICY IF EXISTS "Service role full access on agent_memory" ON agent_memory;
DROP POLICY IF EXISTS "Authenticated read-only on agent_memory" ON agent_memory;

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_memory_select_user" ON agent_memory
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "agent_memory_insert_user" ON agent_memory
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_memory_update_user" ON agent_memory
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_memory_delete_user" ON agent_memory
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ============================================================
-- cron_jobs
-- Migration 005 (via supabase-schema.sql) created select/insert/update
-- policies but no delete policy. All three are dropped and replaced.
-- ============================================================
DROP POLICY IF EXISTS "cron_jobs_select" ON cron_jobs;
DROP POLICY IF EXISTS "cron_jobs_insert" ON cron_jobs;
DROP POLICY IF EXISTS "cron_jobs_update" ON cron_jobs;

ALTER TABLE cron_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cron_jobs_select_user" ON cron_jobs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "cron_jobs_insert_user" ON cron_jobs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cron_jobs_update_user" ON cron_jobs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cron_jobs_delete_user" ON cron_jobs
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
