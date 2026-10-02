-- Enable RLS on workspace_github_tokens and restrict access
-- Applied 2026-03-08

ALTER TABLE workspace_github_tokens ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by API routes)
CREATE POLICY "Service role full access" ON workspace_github_tokens
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Restrict anon/authenticated to tokens for workspaces in their org
CREATE POLICY "Users can view tokens for their org workspaces" ON workspace_github_tokens
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT w.id FROM workspaces w
      JOIN org_members om ON om.org_id = w.org_id
      WHERE om.user_id = auth.uid()
    )
  );
