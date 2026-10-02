-- brain_section_hashes: tracks per-section content hashes for brain manifest files
-- Enables section-level fork detection instead of whole-file comparison
-- Part of Day 1 Brain V2 — Per-Section Merge Resolution

-- 1. Create table
CREATE TABLE IF NOT EXISTS brain_section_hashes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id UUID NOT NULL REFERENCES brain_manifest(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  is_forked BOOLEAN NOT NULL DEFAULT false,
  update_available BOOLEAN NOT NULL DEFAULT false,
  update_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (manifest_id, section_key)
);

-- 2. Indexes
CREATE INDEX idx_brain_section_hashes_manifest_id
  ON brain_section_hashes (manifest_id);

-- 3. Updated_at trigger (20260313_org_shared_agents.sql defines the same function and sorts later)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_brain_section_hashes_updated_at
  BEFORE UPDATE ON brain_section_hashes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 4. Enable RLS
ALTER TABLE brain_section_hashes ENABLE ROW LEVEL SECURITY;

-- SELECT: workspace members can read (join through brain_manifest -> workspaces -> workspace_memberships)
CREATE POLICY brain_section_hashes_select ON brain_section_hashes
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM brain_manifest bm
      JOIN workspace_memberships wm ON wm.workspace_id = bm.workspace_id
      WHERE bm.id = brain_section_hashes.manifest_id
        AND wm.user_id = auth.uid()
    )
  );

-- INSERT: workspace members can insert
CREATE POLICY brain_section_hashes_insert ON brain_section_hashes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM brain_manifest bm
      JOIN workspace_memberships wm ON wm.workspace_id = bm.workspace_id
      WHERE bm.id = brain_section_hashes.manifest_id
        AND wm.user_id = auth.uid()
    )
  );

-- UPDATE: workspace owners/admins only
CREATE POLICY brain_section_hashes_update ON brain_section_hashes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM brain_manifest bm
      JOIN workspace_memberships wm ON wm.workspace_id = bm.workspace_id
      JOIN roles r ON r.id = wm.role_id
      WHERE bm.id = brain_section_hashes.manifest_id
        AND wm.user_id = auth.uid()
        AND r.slug IN ('owner', 'admin')
    )
  );

-- DELETE: workspace owners/admins only
CREATE POLICY brain_section_hashes_delete ON brain_section_hashes
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM brain_manifest bm
      JOIN workspace_memberships wm ON wm.workspace_id = bm.workspace_id
      JOIN roles r ON r.id = wm.role_id
      WHERE bm.id = brain_section_hashes.manifest_id
        AND wm.user_id = auth.uid()
        AND r.slug IN ('owner', 'admin')
    )
  );
