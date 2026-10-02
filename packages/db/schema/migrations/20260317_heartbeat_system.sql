-- Heartbeat System Revitalization
-- Creates heartbeat_events table, cron_jobs table, adds constraints to agent_status

-- 1. Fix agent_status constraints for multi-tenant
ALTER TABLE agent_status DROP CONSTRAINT IF EXISTS agent_status_agent_name_key;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_status_workspace_agent_unique') THEN
    ALTER TABLE agent_status ADD CONSTRAINT agent_status_workspace_agent_unique UNIQUE (workspace_id, agent_name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_status_workspace ON agent_status(workspace_id);

-- 2. Create heartbeat_events table for activity timeline
CREATE TABLE IF NOT EXISTS heartbeat_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'online', 'offline', 'working', 'idle',
    'stale_reset', 'task_started', 'task_completed',
    'alert_fired', 'health_check'
  )),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_events_workspace ON heartbeat_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeat_events_agent ON heartbeat_events(workspace_id, agent_id, created_at DESC);

ALTER TABLE heartbeat_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "heartbeat_events_select" ON heartbeat_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "heartbeat_events_insert" ON heartbeat_events FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');

-- 3. Create cron_jobs table
CREATE TABLE IF NOT EXISTS cron_jobs (
  job_id text PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  schedule_description text NOT NULL,
  schedule_seconds integer,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_status text CHECK (last_run_status IN ('running', 'success', 'failure')),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The base schema already creates cron_jobs without these two columns.
ALTER TABLE cron_jobs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

ALTER TABLE cron_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cron_jobs_select" ON cron_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "cron_jobs_insert" ON cron_jobs FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "cron_jobs_update" ON cron_jobs FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_cron_jobs_workspace ON cron_jobs(workspace_id) WHERE enabled = true;

CREATE TRIGGER cron_jobs_updated_at
  BEFORE UPDATE ON cron_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
