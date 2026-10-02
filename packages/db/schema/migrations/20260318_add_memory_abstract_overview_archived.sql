-- Add abstract, overview, is_archived columns to agent_memory
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS abstract varchar(500);
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS overview text;
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false NOT NULL;

-- Index for filtering out archived memories efficiently
CREATE INDEX IF NOT EXISTS idx_agent_memory_not_archived
  ON agent_memory(workspace_id) WHERE NOT is_archived;

-- Index for hotness scoring (access_count + last_accessed_at)
CREATE INDEX IF NOT EXISTS idx_agent_memory_hotness
  ON agent_memory(workspace_id, importance_score DESC, access_count DESC)
  WHERE NOT is_archived;
