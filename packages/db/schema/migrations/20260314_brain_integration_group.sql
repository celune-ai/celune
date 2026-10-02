-- Add integration_group column to brain_manifest for categorizing updates
-- NULL = core (always available), otherwise gated by integration connection
ALTER TABLE brain_manifest
  ADD COLUMN IF NOT EXISTS integration_group text
  CHECK (integration_group IS NULL OR integration_group IN ('github', 'slack', 'voice', 'byok'));

-- Index for filtering updates by integration group
CREATE INDEX IF NOT EXISTS idx_brain_manifest_integration_group
  ON brain_manifest (workspace_id, integration_group)
  WHERE integration_group IS NOT NULL;

COMMENT ON COLUMN brain_manifest.integration_group IS
  'Integration group for categorizing updates. NULL = core (always available). Non-null values gated by integration connection status.';
