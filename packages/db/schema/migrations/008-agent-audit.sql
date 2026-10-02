-- 008-agent-audit.sql
-- Add agent_id column to activity_log for agent audit trail.
-- Extends the existing activity_log table (no new tables).

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS agent_id text;

-- Index for filtering by agent
CREATE INDEX IF NOT EXISTS idx_activity_log_agent_id
  ON activity_log (agent_id)
  WHERE agent_id IS NOT NULL;

-- Composite index for agent timeline queries (agent + newest first)
CREATE INDEX IF NOT EXISTS idx_activity_log_agent_time
  ON activity_log (agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;
