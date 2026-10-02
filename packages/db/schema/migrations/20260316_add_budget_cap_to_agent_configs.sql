ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS budget_cap_usd numeric DEFAULT NULL;
COMMENT ON COLUMN agent_configs.budget_cap_usd IS 'Monthly budget cap in USD. NULL means unlimited. Agent is paused when spend exceeds this.';
