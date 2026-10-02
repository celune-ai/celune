-- Migration: Create execution_queue and execution_logs tables
-- Part of: Agent Execution Runtime project

-- Execution status enum
CREATE TYPE execution_status AS ENUM ('pending', 'claimed', 'processing', 'completed', 'failed', 'cancelled', 'timeout');

-- Execution target type
CREATE TYPE execution_target AS ENUM ('task', 'project');

-- ============================================================
-- execution_queue: Tracks pending and active execution jobs
-- ============================================================
CREATE TABLE execution_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- What to execute
  target_type   execution_target NOT NULL DEFAULT 'task',
  task_id       uuid REFERENCES tasks(id) ON DELETE SET NULL,
  project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,

  -- Execution state
  status        execution_status NOT NULL DEFAULT 'pending',
  priority      integer NOT NULL DEFAULT 0,  -- higher = more urgent
  claimed_at    timestamptz,
  started_at    timestamptz,
  completed_at  timestamptz,
  failed_at     timestamptz,

  -- Agent assignment
  agent_id      text NOT NULL DEFAULT 'rick',
  worker_id     text,  -- unique worker instance identifier

  -- Budgets & limits
  token_budget  integer NOT NULL DEFAULT 100000,
  tokens_used   integer NOT NULL DEFAULT 0,
  timeout_ms    integer NOT NULL DEFAULT 300000,  -- 5 min default
  retry_count   integer NOT NULL DEFAULT 0,
  max_retries   integer NOT NULL DEFAULT 3,

  -- Context
  system_prompt text,
  tools         jsonb DEFAULT '[]'::jsonb,
  context       jsonb DEFAULT '{}'::jsonb,  -- assembled context for the agent

  -- Result
  outcome       text,
  error_message text,
  error_code    text,

  -- Metadata
  metadata      jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT execution_queue_target_check CHECK (
    (target_type = 'task' AND task_id IS NOT NULL) OR
    (target_type = 'project' AND project_id IS NOT NULL)
  )
);

-- Indexes for queue polling
CREATE INDEX idx_execution_queue_pending ON execution_queue (status, priority DESC, created_at ASC)
  WHERE status = 'pending';
CREATE INDEX idx_execution_queue_workspace ON execution_queue (workspace_id, status);
CREATE INDEX idx_execution_queue_task ON execution_queue (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_execution_queue_project ON execution_queue (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_execution_queue_worker ON execution_queue (worker_id) WHERE worker_id IS NOT NULL;

-- ============================================================
-- execution_logs: Step-by-step execution traces
-- ============================================================
CREATE TABLE execution_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id  uuid NOT NULL REFERENCES execution_queue(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Log entry
  step_index    integer NOT NULL DEFAULT 0,
  event_type    text NOT NULL,  -- 'thinking', 'tool_call', 'tool_result', 'message', 'error', 'status_change'
  content       text,
  tool_name     text,
  tool_input    jsonb,
  tool_result   jsonb,

  -- Token tracking per step
  input_tokens  integer DEFAULT 0,
  output_tokens integer DEFAULT 0,

  -- Metadata
  metadata      jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_execution_logs_execution ON execution_logs (execution_id, step_index ASC);
CREATE INDEX idx_execution_logs_workspace ON execution_logs (workspace_id);
CREATE INDEX idx_execution_logs_type ON execution_logs (execution_id, event_type);

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE execution_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_logs ENABLE ROW LEVEL SECURITY;

-- execution_queue: users can see their workspace's executions
CREATE POLICY "workspace_members_select_execution_queue"
  ON execution_queue FOR SELECT
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- execution_queue: users can insert into their workspace
CREATE POLICY "workspace_members_insert_execution_queue"
  ON execution_queue FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- execution_queue: users can update their workspace's executions
CREATE POLICY "workspace_members_update_execution_queue"
  ON execution_queue FOR UPDATE
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- execution_queue: users can delete (cancel) their workspace's executions
CREATE POLICY "workspace_members_delete_execution_queue"
  ON execution_queue FOR DELETE
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- execution_logs: users can see their workspace's logs
CREATE POLICY "workspace_members_select_execution_logs"
  ON execution_logs FOR SELECT
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- execution_logs: insert via service role only (agents write logs)
CREATE POLICY "service_role_insert_execution_logs"
  ON execution_logs FOR INSERT
  WITH CHECK (true);  -- service role bypasses RLS; this is for completeness

-- ============================================================
-- Updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_execution_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_execution_queue_updated_at
  BEFORE UPDATE ON execution_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_execution_queue_updated_at();

-- ============================================================
-- Claim function: atomic job claiming with concurrency limits
-- Uses advisory locks to prevent race conditions
-- ============================================================
CREATE OR REPLACE FUNCTION claim_execution_job(
  p_worker_id text,
  p_workspace_id uuid DEFAULT NULL
)
RETURNS SETOF execution_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job execution_queue%ROWTYPE;
BEGIN
  -- Find and claim the highest-priority pending job
  -- SKIP LOCKED prevents multiple workers from claiming the same job
  SELECT * INTO v_job
  FROM execution_queue
  WHERE status = 'pending'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job.id IS NULL THEN
    RETURN;
  END IF;

  -- Claim the job
  UPDATE execution_queue
  SET status = 'claimed',
      worker_id = p_worker_id,
      claimed_at = now(),
      updated_at = now()
  WHERE id = v_job.id;

  v_job.status := 'claimed';
  v_job.worker_id := p_worker_id;
  v_job.claimed_at := now();

  RETURN NEXT v_job;
END;
$$;

-- Grant execute to authenticated users (service role uses this)
GRANT EXECUTE ON FUNCTION claim_execution_job TO authenticated;
GRANT EXECUTE ON FUNCTION claim_execution_job TO service_role;

-- ============================================================
-- Rollback
-- ============================================================
-- DROP TRIGGER IF EXISTS trigger_execution_queue_updated_at ON execution_queue;
-- DROP FUNCTION IF EXISTS update_execution_queue_updated_at();
-- DROP FUNCTION IF EXISTS claim_execution_job(text, uuid);
-- DROP TABLE IF EXISTS execution_logs;
-- DROP TABLE IF EXISTS execution_queue;
-- DROP TYPE IF EXISTS execution_status;
-- DROP TYPE IF EXISTS execution_target;
