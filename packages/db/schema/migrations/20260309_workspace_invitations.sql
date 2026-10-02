-- Workspace invitations table for team tier multi-user onboarding
-- Allows workspace owners to invite members via email with a secure token

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  invited_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  token       text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
  -- No table-level unique constraint; the partial index below covers it
);

-- Prevent duplicate pending invitations for the same email in the same workspace
-- (allows re-inviting after revoke/expire)
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invitations_unique_pending
  ON workspace_invitations(workspace_id, email) WHERE status = 'pending';

-- Index for token lookups (accept flow)
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_token ON workspace_invitations(token) WHERE status = 'pending';

-- Index for listing invitations by workspace
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace ON workspace_invitations(workspace_id, status);

-- RLS policies
ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;

-- Workspace members can read invitations for their workspace
CREATE POLICY workspace_invitations_select ON workspace_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = workspace_invitations.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Only org owners/admins can insert invitations (role check via org_memberships)
CREATE POLICY workspace_invitations_insert ON workspace_invitations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
        JOIN workspaces w ON w.id = wm.workspace_id
        JOIN org_memberships om ON om.org_id = w.org_id AND om.user_id = wm.user_id
      WHERE wm.workspace_id = workspace_invitations.workspace_id
        AND wm.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- Only the inviter or org owners can revoke/update invitations
CREATE POLICY workspace_invitations_update ON workspace_invitations
  FOR UPDATE
  USING (
    invited_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspace_memberships wm
        JOIN workspaces w ON w.id = wm.workspace_id
        JOIN org_memberships om ON om.org_id = w.org_id AND om.user_id = wm.user_id
      WHERE wm.workspace_id = workspace_invitations.workspace_id
        AND wm.user_id = auth.uid()
        AND om.role = 'owner'
    )
  );

-- Only the inviter or org owners can delete invitations
CREATE POLICY workspace_invitations_delete ON workspace_invitations
  FOR DELETE
  USING (
    invited_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspace_memberships wm
        JOIN workspaces w ON w.id = wm.workspace_id
        JOIN org_memberships om ON om.org_id = w.org_id AND om.user_id = wm.user_id
      WHERE wm.workspace_id = workspace_invitations.workspace_id
        AND wm.user_id = auth.uid()
        AND om.role = 'owner'
    )
  );
