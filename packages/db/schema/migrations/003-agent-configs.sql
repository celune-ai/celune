-- 003-agent-configs.sql
-- Persists agent personality parameters and active profile per agent.
-- agent_id matches the id field in apps/platform/src/lib/agents-data.ts.
-- Run in: Supabase Dashboard → SQL Editor → New Query

CREATE TABLE agent_configs (
  agent_id text PRIMARY KEY,
  parameters jsonb NOT NULL DEFAULT '{}',
  active_profile text NOT NULL DEFAULT 'default',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_configs_select" ON agent_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "agent_configs_insert" ON agent_configs FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "agent_configs_update" ON agent_configs FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "agent_configs_delete" ON agent_configs FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

CREATE TRIGGER agent_configs_updated_at
  BEFORE UPDATE ON agent_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
