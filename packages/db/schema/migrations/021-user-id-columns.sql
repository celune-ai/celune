-- 021-user-id-columns.sql
-- P0: Add user_id/org_id columns for multi-tenancy
-- Adds user_id (FK → auth.users) to all data tables so rows can be scoped per user.
-- Columns are NULLABLE initially — backfill happens in a separate task.
-- org_id added as NULLABLE to projects and tasks for future workspace/team support.
--
-- ROLLBACK:
--   ALTER TABLE projects DROP COLUMN IF EXISTS user_id;
--   ALTER TABLE projects DROP COLUMN IF EXISTS org_id;
--   ALTER TABLE tasks DROP COLUMN IF EXISTS user_id;
--   ALTER TABLE tasks DROP COLUMN IF EXISTS org_id;
--   ALTER TABLE project_groups DROP COLUMN IF EXISTS user_id;
--   ALTER TABLE activity_log DROP COLUMN IF EXISTS user_id;
--   ALTER TABLE task_comments DROP COLUMN IF EXISTS user_id;
--   ALTER TABLE agent_status DROP COLUMN IF EXISTS user_id;
--   ALTER TABLE agent_configs DROP COLUMN IF EXISTS user_id;
--   ALTER TABLE agent_memory DROP COLUMN IF EXISTS user_id;
--   ALTER TABLE cron_jobs DROP COLUMN IF EXISTS user_id;
--   DROP INDEX IF EXISTS idx_projects_user_id;
--   DROP INDEX IF EXISTS idx_tasks_user_id;
--   DROP INDEX IF EXISTS idx_project_groups_user_id;
--   DROP INDEX IF EXISTS idx_activity_log_user_id;
--   DROP INDEX IF EXISTS idx_task_comments_user_id;
--   DROP INDEX IF EXISTS idx_agent_status_user_id;
--   DROP INDEX IF EXISTS idx_agent_configs_user_id;
--   DROP INDEX IF EXISTS idx_agent_memory_user_id;
--   DROP INDEX IF EXISTS idx_cron_jobs_user_id;

-- ============================================
-- projects
-- ============================================
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS org_id  uuid;  -- nullable, for future workspace/team support

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- ============================================
-- tasks
-- ============================================
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS org_id  uuid;  -- nullable, for future workspace/team support

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);

-- ============================================
-- project_groups
-- ============================================
ALTER TABLE project_groups
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_project_groups_user_id ON project_groups(user_id);

-- ============================================
-- activity_log
-- ============================================
ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);

-- ============================================
-- task_comments
-- ============================================
ALTER TABLE task_comments
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON task_comments(user_id);

-- ============================================
-- agent_status
-- ============================================
ALTER TABLE agent_status
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_agent_status_user_id ON agent_status(user_id);

-- ============================================
-- agent_configs
-- ============================================
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_agent_configs_user_id ON agent_configs(user_id);

-- ============================================
-- agent_memory
-- ============================================
ALTER TABLE agent_memory
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_agent_memory_user_id ON agent_memory(user_id);

-- ============================================
-- cron_jobs
-- ============================================
ALTER TABLE cron_jobs
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_cron_jobs_user_id ON cron_jobs(user_id);
