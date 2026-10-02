-- brain_manifest: tracks CORE brain files per workspace with content hashes for fork detection
-- Part of Day 1 Brain V2 — CORE

-- 1. Create table
CREATE TABLE IF NOT EXISTS brain_manifest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  tier TEXT NOT NULL CHECK (tier IN ('essential', 'standard', 'premium')),
  category TEXT NOT NULL CHECK (category IN ('skill', 'hook', 'agent', 'agent_doc', 'memory', 'settings', 'delegation')),
  is_core BOOLEAN NOT NULL DEFAULT true,
  is_forked BOOLEAN NOT NULL DEFAULT false,
  forked_at TIMESTAMPTZ,
  update_available BOOLEAN NOT NULL DEFAULT false,
  update_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, path)
);

-- 2. Indexes
CREATE INDEX idx_brain_manifest_workspace_core_updates
  ON brain_manifest (workspace_id, is_core, update_available);

CREATE INDEX idx_brain_manifest_workspace_forked
  ON brain_manifest (workspace_id, is_forked)
  WHERE is_forked = true;

-- 3. Updated_at trigger
CREATE OR REPLACE FUNCTION update_brain_manifest_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_brain_manifest_updated_at
  BEFORE UPDATE ON brain_manifest
  FOR EACH ROW
  EXECUTE FUNCTION update_brain_manifest_updated_at();

-- 4. Enable RLS
ALTER TABLE brain_manifest ENABLE ROW LEVEL SECURITY;

-- SELECT: workspace members can read their manifest
CREATE POLICY brain_manifest_select ON brain_manifest
  FOR SELECT USING (
    workspace_id IN (
      SELECT wm.workspace_id
      FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- INSERT: workspace members can insert into their manifest
CREATE POLICY brain_manifest_insert ON brain_manifest
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT wm.workspace_id
      FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- UPDATE: workspace owners/admins can update their manifest
CREATE POLICY brain_manifest_update ON brain_manifest
  FOR UPDATE USING (
    workspace_id IN (
      SELECT wm.workspace_id
      FROM workspace_memberships wm
      JOIN roles r ON r.id = wm.role_id
      WHERE wm.user_id = auth.uid()
        AND r.slug IN ('owner', 'admin')
    )
  );

-- DELETE: workspace owners/admins can delete from their manifest
CREATE POLICY brain_manifest_delete ON brain_manifest
  FOR DELETE USING (
    workspace_id IN (
      SELECT wm.workspace_id
      FROM workspace_memberships wm
      JOIN roles r ON r.id = wm.role_id
      WHERE wm.user_id = auth.uid()
        AND r.slug IN ('owner', 'admin')
    )
  );
