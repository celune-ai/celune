-- Performance indexes for common query patterns identified in QA deep scan.
-- These cover: unacknowledged alerts dashboard, memory list pagination, and activity audit filtering.

-- Unacknowledged alerts — used by getActivity() with acknowledged_at IS NULL filter + created_at DESC sort
CREATE INDEX IF NOT EXISTS idx_activity_log_unacknowledged_created
  ON activity_log(created_at DESC)
  WHERE acknowledged_at IS NULL;

-- Agent memory workspace+category+updated_at — used by getAgentMemoryEntries() pagination
CREATE INDEX IF NOT EXISTS idx_agent_memory_workspace_category_updated
  ON agent_memory(workspace_id, category, updated_at DESC);

-- Activity log workspace+event_type+agent_id — used by getActivity() multi-filter queries
CREATE INDEX IF NOT EXISTS idx_activity_log_workspace_event_agent
  ON activity_log(workspace_id, event_type, agent_id, created_at DESC);
