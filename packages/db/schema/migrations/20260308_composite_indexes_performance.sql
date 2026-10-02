-- Performance: composite indexes for common query patterns
-- These cover the most frequent queries in analytics, task board, and activity log

-- Tasks: workspace + status (task board filtering, analytics counts)
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status
  ON tasks (workspace_id, status);

-- Tasks: workspace + completed_at (analytics velocity, completion sparklines)
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_completed_at
  ON tasks (workspace_id, completed_at)
  WHERE completed_at IS NOT NULL;

-- Tasks: project + status (project task counts, kanban board)
CREATE INDEX IF NOT EXISTS idx_tasks_project_status
  ON tasks (project_id, status)
  WHERE project_id IS NOT NULL;

-- Activity log: workspace + created_at (error rate, event counts)
CREATE INDEX IF NOT EXISTS idx_activity_log_workspace_created_at
  ON activity_log (workspace_id, created_at);

-- Claude usage: workspace + created_at (cost analytics, trend charts)
CREATE INDEX IF NOT EXISTS idx_claude_usage_workspace_created_at
  ON claude_usage (workspace_id, created_at);

-- Rollback:
-- DROP INDEX IF EXISTS idx_tasks_workspace_status;
-- DROP INDEX IF EXISTS idx_tasks_workspace_completed_at;
-- DROP INDEX IF EXISTS idx_tasks_project_status;
-- DROP INDEX IF EXISTS idx_activity_log_workspace_created_at;
-- DROP INDEX IF EXISTS idx_claude_usage_workspace_created_at;
