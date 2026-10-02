-- Sentry installation mapping: links Sentry installation UUIDs to workspaces
-- for validating webhook payloads (fail closed on unknown installations).
--
-- Part of: WARD Auto-Fix Agent (project e88de701)

CREATE TABLE IF NOT EXISTS sentry_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  installation_uuid TEXT NOT NULL UNIQUE,
  organization_slug TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sentry_installations_workspace
  ON sentry_installations (workspace_id);

CREATE INDEX IF NOT EXISTS idx_sentry_installations_uuid
  ON sentry_installations (installation_uuid) WHERE is_active = true;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_sentry_installations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sentry_installations_updated_at
  BEFORE UPDATE ON sentry_installations
  FOR EACH ROW
  EXECUTE FUNCTION update_sentry_installations_updated_at();

-- RLS
ALTER TABLE sentry_installations ENABLE ROW LEVEL SECURITY;

CREATE POLICY sentry_installations_select ON sentry_installations
  FOR SELECT USING (
    workspace_id IN (
      SELECT wm.workspace_id
      FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );
