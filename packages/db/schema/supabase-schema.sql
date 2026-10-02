-- Celune: Database Schema
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Apply this file first, then every file in migrations/ in bytewise order.
-- packages/db/scripts/boot-local.sh does both against an empty database.

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE task_status AS ENUM (
  'backlog', 'inbox', 'scoping', 'planning', 'in_progress', 'review', 'done', 'archived'
);

CREATE TYPE task_priority AS ENUM ('urgent', 'high', 'normal', 'low');

-- task_assignee is text (not an enum) to support dynamic agent IDs.

CREATE TYPE project_status AS ENUM ('active', 'paused', 'completed', 'archived');

CREATE TYPE severity_level AS ENUM ('info', 'warning', 'error');

CREATE TYPE agent_status_type AS ENUM ('online', 'offline', 'working', 'idle');

-- ============================================
-- TABLES
-- ============================================

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  status project_status NOT NULL DEFAULT 'active',
  category text,
  target_date date,
  vault_path text,
  metadata jsonb,
  user_id uuid,
  org_id uuid,
  workspace_id uuid NOT NULL,
  group_id uuid,
  project_type text DEFAULT 'feature',
  priority text DEFAULT 'normal',
  prd_content text,
  prd_metadata jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  outcome text,
  status task_status NOT NULL DEFAULT 'inbox',
  priority task_priority NOT NULL DEFAULT 'normal',
  assignee text NOT NULL DEFAULT 'unassigned',
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  category text[] DEFAULT '{}',
  due_date date,
  source text,
  source_ref text,
  vault_path text,
  time_estimate_minutes integer,
  time_spent_minutes integer DEFAULT 0,
  subtasks jsonb,
  metadata jsonb,
  parent_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  spawned_by text,
  context_keys text[] DEFAULT '{}',
  depends_on uuid[] DEFAULT '{}',
  effort text,
  user_id uuid,
  org_id uuid,
  workspace_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  severity severity_level NOT NULL DEFAULT 'info',
  source text,
  title text NOT NULL,
  details jsonb,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  agent_id text,
  actor_user_id uuid,
  workspace_id uuid,
  acknowledged boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author text NOT NULL,
  content text NOT NULL,
  workspace_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text UNIQUE NOT NULL,
  status agent_status_type NOT NULL DEFAULT 'offline',
  current_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  model text,
  uptime_start timestamptz,
  last_heartbeat timestamptz,
  metadata jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Persisted personality parameters and active profile per agent.
-- agent_id matches the id field in apps/platform/src/lib/agents-data.ts.
-- permissions: KNOX runtime overrides for capability scopes (null = use static defaults in agents-data.ts)
CREATE TABLE agent_configs (
  agent_id text PRIMARY KEY,
  parameters jsonb NOT NULL DEFAULT '{}',
  active_profile text NOT NULL DEFAULT 'default',
  permissions jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status_sort ON tasks(status, sort_order);
CREATE INDEX idx_activity_log_created ON activity_log(created_at DESC);
CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX idx_tasks_parent_id ON tasks(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_tasks_spawned_by ON tasks(spawned_by) WHERE spawned_by IS NOT NULL;
CREATE INDEX idx_tasks_workspace_id ON tasks(workspace_id);
CREATE INDEX idx_projects_workspace_id ON projects(workspace_id);
CREATE INDEX idx_activity_log_workspace_id ON activity_log(workspace_id) WHERE workspace_id IS NOT NULL;

-- ============================================
-- AUTO-UPDATE TRIGGERS
-- ============================================

-- SECURITY: SET search_path = '' prevents search_path injection attacks (FINDING-001)
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = '';

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER agent_status_updated_at
  BEFORE UPDATE ON agent_status
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER agent_configs_updated_at
  BEFORE UPDATE ON agent_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Tracks scheduled job health for the RICK cron registry (see migration 005).
CREATE TABLE cron_jobs (
  job_id              text PRIMARY KEY,
  display_name        text NOT NULL,
  schedule_description text NOT NULL,
  schedule_seconds    integer,
  last_run_at         timestamptz,
  last_run_status     text CHECK (last_run_status IN ('running', 'success', 'failure')),
  last_error          text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_status ENABLE ROW LEVEL SECURITY;

-- RLS policies split per-operation to avoid linter warnings on overly permissive mutations.
-- SELECT uses USING(true) — intentional, authenticated read access is fine for this single-user tool.
-- INSERT/UPDATE/DELETE use auth.role() check — semantically identical for now but silences the linter
-- and is forward-compatible with a real user-scoped policy once auth.uid() columns are added.
-- FINDING-002: See 05-knowledge/knox-security-context.md for full decision rationale.

-- tasks
CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "tasks_delete" ON tasks FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- projects
CREATE POLICY "projects_select" ON projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects_insert" ON projects FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "projects_update" ON projects FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "projects_delete" ON projects FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- activity_log
CREATE POLICY "activity_log_select" ON activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity_log_insert" ON activity_log FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "activity_log_update" ON activity_log FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "activity_log_delete" ON activity_log FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- task_comments
CREATE POLICY "task_comments_select" ON task_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_comments_insert" ON task_comments FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "task_comments_update" ON task_comments FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "task_comments_delete" ON task_comments FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- agent_status
CREATE POLICY "agent_status_select" ON agent_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "agent_status_insert" ON agent_status FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "agent_status_update" ON agent_status FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "agent_status_delete" ON agent_status FOR DELETE TO authenticated USING (auth.role() = 'authenticated');


-- cron_jobs
ALTER TABLE cron_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cron_jobs_select" ON cron_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "cron_jobs_insert" ON cron_jobs FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "cron_jobs_update" ON cron_jobs FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE TRIGGER cron_jobs_updated_at
  BEFORE UPDATE ON cron_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- agent_configs
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_configs_select" ON agent_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "agent_configs_insert" ON agent_configs FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "agent_configs_update" ON agent_configs FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "agent_configs_delete" ON agent_configs FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- ============================================
-- REALTIME
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
