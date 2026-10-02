-- Add trial token budget to workspaces for BYOK grace period.
-- New users get a small free budget to experience AI features before
-- being required to configure their own API key.
--
-- trial_tokens_used tracks cumulative usage against trial_token_budget.
-- Once used >= budget, AI features are gated until BYOK is configured.
--
-- Rollback:
--   ALTER TABLE workspaces DROP COLUMN IF EXISTS trial_token_budget;
--   ALTER TABLE workspaces DROP COLUMN IF EXISTS trial_tokens_used;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS trial_token_budget integer NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS trial_tokens_used  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN workspaces.trial_token_budget IS 'Max free tokens before BYOK key is required (default 50k ≈ $0.75 of Claude Sonnet)';
COMMENT ON COLUMN workspaces.trial_tokens_used IS 'Cumulative tokens consumed against the trial budget';
