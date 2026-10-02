-- Add indexes for common analytics query patterns
-- These support the most frequent filter combinations in analytics API routes

-- activity_log: frequently filtered by workspace_id + created_at (errors, utilization)
CREATE INDEX IF NOT EXISTS idx_activity_log_workspace_created
  ON activity_log (workspace_id, created_at DESC);

-- activity_log: frequently filtered by agent_id + created_at (utilization, agent audit)
CREATE INDEX IF NOT EXISTS idx_activity_log_agent_created
  ON activity_log (agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

-- tasks: frequently filtered by status + workspace_id (priorities, velocity, completion-time)
CREATE INDEX IF NOT EXISTS idx_tasks_status_workspace
  ON tasks (status, workspace_id);

-- tasks: completed_at queries for velocity analytics
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at
  ON tasks (completed_at DESC)
  WHERE status = 'done' AND completed_at IS NOT NULL;

-- claude_usage: cost trend queries by workspace + created_at
CREATE INDEX IF NOT EXISTS idx_claude_usage_workspace_created
  ON claude_usage (workspace_id, created_at DESC);

-- usage_events: current month aggregation queries
CREATE INDEX IF NOT EXISTS idx_usage_events_workspace_created
  ON usage_events (workspace_id, created_at DESC);

-- usage_summaries: dashboard summary queries
CREATE INDEX IF NOT EXISTS idx_usage_summaries_workspace_period
  ON usage_summaries (workspace_id, period_type, period_start DESC);
