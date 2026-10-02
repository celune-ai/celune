-- Per-workspace AI budget: a monthly token cap and a per-minute request cap.
-- NULL means unlimited. Enforced in apps/platform/src/lib/ai-budget.ts before
-- any provider key (BYOK or host-provided) is handed to a caller.
--
-- Rollback:
--   ALTER TABLE workspaces DROP COLUMN IF EXISTS ai_token_limit_monthly;
--   ALTER TABLE workspaces DROP COLUMN IF EXISTS ai_requests_per_minute;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS ai_token_limit_monthly bigint
    CHECK (ai_token_limit_monthly IS NULL OR ai_token_limit_monthly >= 0),
  ADD COLUMN IF NOT EXISTS ai_requests_per_minute integer
    CHECK (ai_requests_per_minute IS NULL OR ai_requests_per_minute >= 0);

COMMENT ON COLUMN workspaces.ai_token_limit_monthly IS 'Max LLM tokens (input + output) per calendar month, NULL = unlimited';
COMMENT ON COLUMN workspaces.ai_requests_per_minute IS 'Max LLM requests per minute across the workspace, NULL = unlimited';
