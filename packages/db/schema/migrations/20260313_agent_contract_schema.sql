-- Add contract_schema to agent_configs for contract-first agent spawning.
-- Stores typed delegation contracts that define input/output schemas,
-- cost ceilings, tool restrictions, and model tier per agent.
--
-- Part of: Second Brain Enterprise Patterns

-- 1. Add contract_schema JSONB column (nullable — not all agents need contracts)
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS contract_schema JSONB;

-- 2. Add a comment explaining the schema
COMMENT ON COLUMN agent_configs.contract_schema IS
  'AgentContract JSON: defines input/output schemas, cost ceiling, tool whitelist, model tier for typed agent delegation';

-- 3. Index for finding agents with contracts
CREATE INDEX IF NOT EXISTS idx_agent_configs_has_contract
  ON agent_configs (workspace_id)
  WHERE contract_schema IS NOT NULL;
