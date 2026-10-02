-- GitHub Integration: default branch + token cache
-- Applied 2026-03-08

ALTER TABLE workspaces
ADD COLUMN IF NOT EXISTS github_default_branch text DEFAULT 'main';

CREATE TABLE IF NOT EXISTS workspace_github_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  installation_id bigint NOT NULL,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_github_tokens_workspace
  ON workspace_github_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_github_tokens_expires
  ON workspace_github_tokens(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_github_tokens_unique_ws
  ON workspace_github_tokens(workspace_id);
