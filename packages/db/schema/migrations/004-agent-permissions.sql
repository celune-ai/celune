-- 004-agent-permissions.sql
-- Adds a permissions column to agent_configs for KNOX-managed runtime overrides.
-- Static defaults live in apps/platform/src/lib/agents-data.ts.
-- When this column is non-null for an agent, it takes precedence over the static default.
-- Run in: Supabase Dashboard → SQL Editor → New Query

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS permissions jsonb;

-- Index for fast lookup when checking permissions at request time
CREATE INDEX IF NOT EXISTS idx_agent_configs_agent_id ON agent_configs (agent_id);
