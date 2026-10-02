-- AI Job Queue — IDE-First AI Execution
-- Routes AI calls through user's connected IDE subscription via MCP job queue
-- Claim and report protocol: docs/harness/README.md

-- Enums
DO $$ BEGIN
  CREATE TYPE ai_job_type AS ENUM (
    'chat',              -- multi-turn chat completion
    'completion',        -- single-turn completion
    'embedding',         -- text embedding
    'structured_output'  -- JSON-schema constrained output
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ai_job_status AS ENUM (
    'pending',      -- waiting for IDE pickup
    'claimed',      -- IDE has claimed, not yet started
    'streaming',    -- IDE is streaming partial results
    'completed',    -- result delivered
    'failed',       -- IDE reported failure
    'expired',      -- no IDE claimed before timeout
    'cancelled'     -- caller cancelled
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Main table
CREATE TABLE IF NOT EXISTS ai_job_queue (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_id          UUID NOT NULL REFERENCES auth.users(id),

  -- Job definition
  job_type              ai_job_type NOT NULL,
  model                 TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  provider              TEXT NOT NULL DEFAULT 'anthropic',
  priority              INTEGER NOT NULL DEFAULT 0,

  -- Payload (encrypted at rest via application layer AES-256-GCM)
  messages_encrypted    BYTEA,           -- chat/completion: encrypted [{role, content}]
  messages_iv           BYTEA,           -- IV for messages decryption
  input_text_encrypted  BYTEA,           -- embedding: encrypted raw text
  input_text_iv         BYTEA,           -- IV for input_text decryption
  system_prompt_encrypted BYTEA,         -- encrypted system prompt
  system_prompt_iv      BYTEA,           -- IV for system_prompt decryption
  tools                 JSONB,           -- tool definitions (not encrypted — no secrets)
  output_schema         JSONB,           -- structured_output: JSON schema
  max_tokens            INTEGER DEFAULT 4096,
  temperature           NUMERIC(3,2) DEFAULT 0.7,

  -- Queue metadata
  queue_name            TEXT NOT NULL DEFAULT 'default',
  estimated_tokens      INTEGER,         -- rough estimate for IDE decision
  metadata              JSONB DEFAULT '{}',  -- feature-specific context (pr_id, task_id, etc.)
  callback_type         TEXT,            -- dispatcher key: 'pr_review', 'task_gen', 'agent_chat', etc.
  callback_metadata     JSONB DEFAULT '{}',  -- extra context for the callback handler

  -- Lifecycle
  status                ai_job_status NOT NULL DEFAULT 'pending',
  claimed_by_key_id     UUID REFERENCES api_keys(id),
  claimed_at            TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  last_heartbeat_at     TIMESTAMPTZ,

  -- Timeouts (Temporal-inspired)
  schedule_to_start_ms  INTEGER NOT NULL DEFAULT 60000,
  start_to_close_ms     INTEGER NOT NULL DEFAULT 300000,
  heartbeat_interval_ms INTEGER NOT NULL DEFAULT 15000,

  -- Retry
  attempt               INTEGER NOT NULL DEFAULT 0,
  max_attempts          INTEGER NOT NULL DEFAULT 3,
  retry_after           TIMESTAMPTZ,
  last_error            JSONB,

  -- Result (encrypted at rest)
  result_encrypted      BYTEA,           -- encrypted {content, tool_calls, usage, model, finish_reason}
  result_iv             BYTEA,           -- IV for result decryption
  result_hmac           TEXT,            -- HMAC of result for integrity verification

  -- Security
  job_hmac              TEXT NOT NULL,    -- HMAC of job payload, IDE must echo with result
  nonce                 TEXT NOT NULL DEFAULT gen_random_uuid()::text,

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ  -- set by trigger on INSERT
);

-- Indexes for polling performance (critical hot path)
CREATE INDEX idx_ai_jobs_poll
  ON ai_job_queue (workspace_id, status, priority DESC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX idx_ai_jobs_claimed
  ON ai_job_queue (claimed_by_key_id, status)
  WHERE status IN ('claimed', 'streaming');

CREATE INDEX idx_ai_jobs_stale_heartbeat
  ON ai_job_queue (last_heartbeat_at)
  WHERE status IN ('claimed', 'streaming');

CREATE INDEX idx_ai_jobs_expired
  ON ai_job_queue (expires_at)
  WHERE status = 'pending';

CREATE INDEX idx_ai_jobs_workspace_status
  ON ai_job_queue (workspace_id, created_at DESC);

-- RLS: workspace members can read their workspace jobs; service role for writes
ALTER TABLE ai_job_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_jobs_workspace_read" ON ai_job_queue
  FOR SELECT USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- Service role handles all writes (enqueue, claim, submit) — no INSERT/UPDATE/DELETE policies needed
-- MCP routes and API routes use createServiceClient() which bypasses RLS

-- Set expires_at on INSERT based on schedule_to_start_ms
CREATE OR REPLACE FUNCTION set_ai_job_expires_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.expires_at = NEW.created_at + make_interval(secs => NEW.schedule_to_start_ms / 1000.0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_job_set_expires_at
  BEFORE INSERT ON ai_job_queue
  FOR EACH ROW
  EXECUTE FUNCTION set_ai_job_expires_at();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_ai_job_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_job_queue_updated_at
  BEFORE UPDATE ON ai_job_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_job_queue_updated_at();

-- Cleanup cron: expire stale jobs, retry timed-out claims
-- Runs every 30 seconds via pg_cron
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
      CREATE EXTENSION pg_cron;
    ELSE
      RAISE NOTICE 'pg_cron unavailable; ai-job-cleanup schedule skipped';
      RETURN;
    END IF;
  END IF;
  PERFORM cron.schedule('ai-job-cleanup', '30 seconds', $job$
  -- Expire pending jobs past schedule_to_start timeout
  UPDATE ai_job_queue
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending'
    AND expires_at < now();

  -- Retry jobs with missed heartbeats (3x interval = stale)
  UPDATE ai_job_queue
  SET
    status = CASE WHEN attempt < max_attempts THEN 'pending' ELSE 'failed' END,
    attempt = attempt + 1,
    retry_after = CASE
      WHEN attempt < max_attempts THEN now() + make_interval(secs => power(2, attempt) * 5)
      ELSE NULL
    END,
    last_error = CASE
      WHEN attempt >= max_attempts THEN '{"code": "timeout_exceeded", "message": "Max retry attempts reached"}'::jsonb
      ELSE last_error
    END,
    claimed_by_key_id = CASE WHEN attempt < max_attempts THEN NULL ELSE claimed_by_key_id END,
    claimed_at = CASE WHEN attempt < max_attempts THEN NULL ELSE claimed_at END,
    updated_at = now()
  WHERE status IN ('claimed', 'streaming')
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at + make_interval(secs => heartbeat_interval_ms * 3 / 1000.0) < now();

  -- Also retry claimed jobs that never sent a first heartbeat (claimed_at + 2x heartbeat interval)
  UPDATE ai_job_queue
  SET
    status = CASE WHEN attempt < max_attempts THEN 'pending' ELSE 'failed' END,
    attempt = attempt + 1,
    last_error = '{"code": "no_heartbeat", "message": "IDE claimed but never started"}'::jsonb,
    claimed_by_key_id = CASE WHEN attempt < max_attempts THEN NULL ELSE claimed_by_key_id END,
    claimed_at = CASE WHEN attempt < max_attempts THEN NULL ELSE claimed_at END,
    updated_at = now()
  WHERE status = 'claimed'
    AND last_heartbeat_at IS NULL
    AND claimed_at + make_interval(secs => heartbeat_interval_ms * 2 / 1000.0) < now();
$job$);
END
$cron$;

COMMENT ON TABLE ai_job_queue IS 'IDE-First AI execution job queue — routes AI calls through connected IDE subscriptions via MCP';
