-- Migration: org_github_installations
-- Maps Celune organizations to GitHub App installations.
-- Replaces per-workspace installation storage with org-level ownership.
-- One GitHub account can only be connected to ONE Celune org (prevents cross-org data access).

CREATE TABLE IF NOT EXISTS org_github_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  installation_id bigint NOT NULL,
  github_account_login text NOT NULL,
  github_account_avatar_url text,
  github_account_type text NOT NULL CHECK (github_account_type IN ('Organization', 'User')),
  connected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,

  -- One Celune org per GitHub account (prevents cross-org access)
  CONSTRAINT uq_org_github_installations_installation UNIQUE (installation_id),
  -- No duplicate connections within an org
  CONSTRAINT uq_org_github_installations_org_install UNIQUE (org_id, installation_id)
);

-- Fast lookup by org
CREATE INDEX idx_org_github_installations_org_id
  ON org_github_installations(org_id);

-- Fast lookup by installation_id (for webhook processing)
CREATE INDEX idx_org_github_installations_installation_id
  ON org_github_installations(installation_id);

-- Enable RLS
ALTER TABLE org_github_installations ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY "Service role full access on org_github_installations"
  ON org_github_installations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Org members can read their org's installations
CREATE POLICY "Org members can read org installations"
  ON org_github_installations
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.is_active = true
    )
  );

-- Org owners can manage installations
CREATE POLICY "Org owners can insert org installations"
  ON org_github_installations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.is_owner = true AND om.is_active = true
    )
  );

CREATE POLICY "Org owners can update org installations"
  ON org_github_installations
  FOR UPDATE
  TO authenticated
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.is_owner = true AND om.is_active = true
    )
  );

CREATE POLICY "Org owners can delete org installations"
  ON org_github_installations
  FOR DELETE
  TO authenticated
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.is_owner = true AND om.is_active = true
    )
  );

-- Also update workspace_github_tokens to index by installation_id (for org-level token lookups)
CREATE INDEX IF NOT EXISTS idx_workspace_github_tokens_installation_id
  ON workspace_github_tokens(installation_id);
