-- Migration: make ai_job_queue the single job queue
-- Adds the runner discriminator and the columns the in-process worker needs,
-- creates job_logs, and drops the execution_queue claim RPC.
-- The enum value must commit before the fold migration uses it, so this file
-- stays separate from 20260926_fold_execution_queue.sql.

-- 1. Job type for server-side agent tool loops
ALTER TYPE ai_job_type ADD VALUE IF NOT EXISTS 'agent_run';

-- 2. Runner discriminator and server-run columns
ALTER TABLE ai_job_queue
  ADD COLUMN IF NOT EXISTS runner       TEXT NOT NULL DEFAULT 'external'
    CHECK (runner IN ('external', 'server')),
  ADD COLUMN IF NOT EXISTS target_type  TEXT
    CHECK (target_type IS NULL OR target_type IN ('task', 'project')),
  ADD COLUMN IF NOT EXISTS target_id    UUID,
  ADD COLUMN IF NOT EXISTS worker_id    TEXT,
  ADD COLUMN IF NOT EXISTS token_budget INTEGER,
  ADD COLUMN IF NOT EXISTS tokens_used  INTEGER NOT NULL DEFAULT 0;

-- A claim belongs to exactly one claimant: an API key or a worker
ALTER TABLE ai_job_queue
  ADD CONSTRAINT ai_job_queue_single_claimant
  CHECK (claimed_by_key_id IS NULL OR worker_id IS NULL);

COMMENT ON COLUMN ai_job_queue.runner IS 'external: polled by an agent holding an API key; server: run by the in-process worker';
COMMENT ON COLUMN ai_job_queue.worker_id IS 'Claimant for server runs; claimed_by_key_id stays NULL';

-- 3. Indexes for the worker and the executions views
CREATE INDEX IF NOT EXISTS idx_ai_jobs_runner_poll
  ON ai_job_queue (workspace_id, runner, status, priority DESC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ai_jobs_target
  ON ai_job_queue (workspace_id, target_id, created_at DESC)
  WHERE target_id IS NOT NULL;

-- 4. Step logs keyed by job id (replaces execution_logs)
CREATE TABLE IF NOT EXISTS job_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES ai_job_queue(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  step_index    INTEGER NOT NULL DEFAULT 0,
  event_type    TEXT NOT NULL,
  content       TEXT,
  tool_name     TEXT,
  tool_input    JSONB,
  tool_result   JSONB,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs (job_id, step_index ASC);
CREATE INDEX IF NOT EXISTS idx_job_logs_workspace ON job_logs (workspace_id);

ALTER TABLE job_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_logs_workspace_read" ON job_logs
  FOR SELECT USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );
-- Writes come from the service role (worker); no INSERT/UPDATE policies needed.

-- 5. The second claim path goes away; JobService.claim is the only claim
DROP FUNCTION IF EXISTS claim_execution_job(text, uuid);

-- Rollback:
-- DROP POLICY IF EXISTS "job_logs_workspace_read" ON job_logs;
-- DROP TABLE IF EXISTS job_logs;
-- DROP INDEX IF EXISTS idx_ai_jobs_target;
-- DROP INDEX IF EXISTS idx_ai_jobs_runner_poll;
-- ALTER TABLE ai_job_queue DROP CONSTRAINT IF EXISTS ai_job_queue_single_claimant;
-- ALTER TABLE ai_job_queue
--   DROP COLUMN IF EXISTS tokens_used, DROP COLUMN IF EXISTS token_budget,
--   DROP COLUMN IF EXISTS worker_id, DROP COLUMN IF EXISTS target_id,
--   DROP COLUMN IF EXISTS target_type, DROP COLUMN IF EXISTS runner;
-- Restore claim_execution_job from 20260321_execution_queue_and_logs.sql.
-- 'agent_run' stays on the enum; PostgreSQL cannot drop enum values.
