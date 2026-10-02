-- Add pod column to agent_configs for team/department grouping
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS pod text;

-- Index for filtering agents by pod within a workspace
CREATE INDEX IF NOT EXISTS idx_agent_configs_pod ON agent_configs(workspace_id, pod) WHERE pod IS NOT NULL;
