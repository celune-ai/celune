-- API Keys for programmatic access
-- Keys use format: celune_live_xxxx (production) / celune_test_xxxx (sandbox)
-- Only the hash is stored; the plaintext key is shown once on creation.

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL CHECK (length(key_prefix) BETWEEN 10 AND 20),
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'test')),
  scopes TEXT[] NOT NULL DEFAULT ARRAY['read'],
  rate_limit_per_minute INT NOT NULL DEFAULT 100,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for key lookup by prefix (used during auth)
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

-- RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "service_role_all" ON api_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can manage keys in their workspaces
CREATE POLICY "workspace_members_read" ON api_keys
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_owners_manage" ON api_keys
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger for updated_at
CREATE OR REPLACE TRIGGER api_keys_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
