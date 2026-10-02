-- Migration: fold execution_queue into ai_job_queue
-- Copies every execution_queue row into ai_job_queue with the same id and
-- runner = 'server', moves execution_logs into job_logs, drops the old tables,
-- and leaves read-only views under the old names for one release.
-- Requires 20260926_ai_job_queue_runner.sql to be committed first.

-- 1. Copy jobs. Same UUID, so execution logs map one to one.
--    job_hmac is a placeholder: HMAC is only checked on the external submit path.
INSERT INTO ai_job_queue (
  id, workspace_id, org_id, requester_id,
  job_type, model, provider, priority,
  tools, max_tokens,
  queue_name, metadata,
  status, worker_id, claimed_at, started_at, completed_at, last_heartbeat_at,
  schedule_to_start_ms, start_to_close_ms, heartbeat_interval_ms,
  attempt, max_attempts, last_error,
  job_hmac, nonce,
  runner, target_type, target_id, token_budget, tokens_used,
  created_at, updated_at
)
SELECT
  eq.id, eq.workspace_id, eq.org_id, eq.user_id,
  'agent_run'::ai_job_type, 'claude-sonnet-4-6', 'anthropic', eq.priority,
  eq.tools, 4096,
  'default',
  COALESCE(eq.metadata, '{}'::jsonb)
    || jsonb_build_object('agent_id', eq.agent_id, 'context', COALESCE(eq.context, '{}'::jsonb))
    || CASE WHEN eq.system_prompt IS NOT NULL
         THEN jsonb_build_object('system_prompt', eq.system_prompt) ELSE '{}'::jsonb END
    || CASE WHEN eq.outcome IS NOT NULL
         THEN jsonb_build_object('outcome', eq.outcome) ELSE '{}'::jsonb END
    || jsonb_build_object('migrated_status', eq.status::text)
    || CASE WHEN eq.failed_at IS NOT NULL
         THEN jsonb_build_object('migrated_failed_at', eq.failed_at) ELSE '{}'::jsonb END,
  CASE eq.status::text
    WHEN 'processing' THEN 'streaming'
    WHEN 'timeout'    THEN 'failed'
    ELSE eq.status::text
  END::ai_job_status,
  eq.worker_id, eq.claimed_at, eq.started_at,
  COALESCE(eq.completed_at, eq.failed_at), COALESCE(eq.started_at, eq.claimed_at, eq.created_at),
  86400000, eq.timeout_ms, 60000,
  eq.retry_count, eq.max_retries,
  CASE WHEN eq.error_message IS NOT NULL OR eq.error_code IS NOT NULL
    THEN jsonb_build_object('code', COALESCE(eq.error_code, 'error'), 'message', COALESCE(eq.error_message, ''))
    ELSE NULL END,
  'migrated:' || eq.id::text, gen_random_uuid()::text,
  'server',
  CASE eq.target_type::text WHEN 'task' THEN 'task' WHEN 'project' THEN 'project' ELSE NULL END,
  CASE eq.target_type::text WHEN 'task' THEN eq.task_id WHEN 'project' THEN eq.project_id ELSE NULL END,
  eq.token_budget, eq.tokens_used,
  eq.created_at, eq.updated_at
FROM execution_queue eq
ON CONFLICT (id) DO NOTHING;

-- The insert trigger sets expires_at from created_at, so an old pending job would be
-- expired by the ai-job-cleanup cron on arrival. Give migrated pending jobs a fresh window.
UPDATE ai_job_queue
SET expires_at = now() + interval '24 hours'
WHERE runner = 'server' AND status = 'pending' AND job_hmac LIKE 'migrated:%';

-- 2. Copy step logs
INSERT INTO job_logs (
  id, job_id, workspace_id, step_index, event_type, content,
  tool_name, tool_input, tool_result, input_tokens, output_tokens, metadata, created_at
)
SELECT
  el.id, el.execution_id, el.workspace_id, el.step_index, el.event_type, el.content,
  el.tool_name, el.tool_input, el.tool_result, el.input_tokens, el.output_tokens, el.metadata, el.created_at
FROM execution_logs el
WHERE EXISTS (SELECT 1 FROM ai_job_queue j WHERE j.id = el.execution_id)
ON CONFLICT (id) DO NOTHING;

-- 3. Drop the old tables (execution_logs FK cascades with execution_queue)
DROP TRIGGER IF EXISTS trigger_execution_queue_updated_at ON execution_queue;
DROP FUNCTION IF EXISTS update_execution_queue_updated_at();
DROP TABLE IF EXISTS execution_logs;
DROP TABLE IF EXISTS execution_queue;

-- 4. Read-only compatibility views under the old names, kept for one release.
--    security_invoker keeps the RLS on ai_job_queue and job_logs in force for callers.
CREATE VIEW execution_queue WITH (security_invoker = true) AS
SELECT
  j.id,
  j.workspace_id,
  j.requester_id                                   AS user_id,
  j.org_id,
  COALESCE(j.target_type, 'external')              AS target_type,
  CASE WHEN j.target_type = 'task'    THEN j.target_id END AS task_id,
  CASE WHEN j.target_type = 'project' THEN j.target_id END AS project_id,
  CASE j.status::text WHEN 'streaming' THEN 'processing' ELSE j.status::text END AS status,
  j.priority,
  j.claimed_at,
  j.started_at,
  j.completed_at,
  CASE WHEN j.status = 'failed' THEN j.completed_at END AS failed_at,
  COALESCE(j.metadata->>'agent_id', 'rick')        AS agent_id,
  j.worker_id,
  j.token_budget,
  j.tokens_used,
  j.start_to_close_ms                              AS timeout_ms,
  j.attempt                                        AS retry_count,
  j.max_attempts                                   AS max_retries,
  j.metadata->>'system_prompt'                     AS system_prompt,
  j.tools,
  COALESCE(j.metadata->'context', '{}'::jsonb)     AS context,
  j.metadata->>'outcome'                           AS outcome,
  j.last_error->>'message'                         AS error_message,
  j.last_error->>'code'                            AS error_code,
  j.metadata,
  j.created_at,
  j.updated_at
FROM ai_job_queue j
WHERE j.runner = 'server';

CREATE VIEW execution_logs WITH (security_invoker = true) AS
SELECT
  l.id,
  l.job_id AS execution_id,
  l.workspace_id,
  l.step_index,
  l.event_type,
  l.content,
  l.tool_name,
  l.tool_input,
  l.tool_result,
  l.input_tokens,
  l.output_tokens,
  l.metadata,
  l.created_at
FROM job_logs l;

REVOKE ALL ON execution_queue, execution_logs FROM anon;

COMMENT ON VIEW execution_queue IS 'Read-only compatibility view over ai_job_queue (runner = server). Remove next release.';
COMMENT ON VIEW execution_logs IS 'Read-only compatibility view over job_logs. Remove next release.';

-- Rollback: there is no automatic reverse. Restore execution_queue and
-- execution_logs from 20260321_execution_queue_and_logs.sql after dropping the
-- views, then copy rows back from ai_job_queue WHERE runner = 'server'.
