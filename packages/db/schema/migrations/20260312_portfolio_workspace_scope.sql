-- Portfolio Workspace Consolidation
-- 1. Add workspace_id FK to portfolio_passwords for multi-tenant scoping
-- 2. Add portfolio_cors_origins to workspaces for per-workspace CORS config

-- ── Step 1: Add workspace_id to portfolio_passwords ──────────────────────────

ALTER TABLE portfolio_passwords
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;

-- Backfill: assign all existing rows to the first workspace (Celune Platform)
UPDATE portfolio_passwords
SET workspace_id = (SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1)
WHERE workspace_id IS NULL;

-- Make workspace_id NOT NULL after backfill
ALTER TABLE portfolio_passwords
  ALTER COLUMN workspace_id SET NOT NULL;

-- Index for workspace-scoped queries
CREATE INDEX IF NOT EXISTS idx_portfolio_passwords_workspace
  ON portfolio_passwords (workspace_id);

-- Drop old unique constraint and replace with workspace-scoped version
DROP INDEX IF EXISTS idx_portfolio_passwords_project_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_passwords_ws_project_hash
  ON portfolio_passwords (workspace_id, project_id, password_hash);

-- RLS policy: service role bypasses, but add policy for completeness
-- (admin app uses service role key for all portfolio operations)
ALTER TABLE portfolio_passwords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to portfolio_passwords" ON portfolio_passwords;
CREATE POLICY "Service role full access to portfolio_passwords"
  ON portfolio_passwords FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── Step 2: Add portfolio_cors_origins to workspaces ─────────────────────────

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS portfolio_cors_origins text[] DEFAULT '{}';

-- Backfill: no default CORS origins (each workspace configures its own)

-- ── Rollback (manual) ────────────────────────────────────────────────────────
-- ALTER TABLE portfolio_passwords DROP COLUMN IF EXISTS workspace_id;
-- DROP INDEX IF EXISTS idx_portfolio_passwords_ws_project_hash;
-- ALTER TABLE workspaces DROP COLUMN IF EXISTS portfolio_cors_origins;
