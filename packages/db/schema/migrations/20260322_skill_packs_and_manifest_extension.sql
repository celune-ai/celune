-- Skill Packs system: extends brain_manifest with skill pack support
-- and creates skill_packs table for packaged skill collections.
--
-- Part of: Brain Manifest / Skill Packs (project c401cdd1)

-- =========================================================================
-- 1. Extend brain_manifest with skill pack fields
-- =========================================================================

-- Add description field for human-readable skill info
ALTER TABLE brain_manifest
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Add tags for searchability (e.g. ['git', 'deployment', 'ci'])
ALTER TABLE brain_manifest
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Link manifest entries to the skill pack they came from (nullable)
ALTER TABLE brain_manifest
  ADD COLUMN IF NOT EXISTS skill_pack_id UUID;

-- Whether this skill was installed from a pack or added individually
ALTER TABLE brain_manifest
  ADD COLUMN IF NOT EXISTS install_source TEXT NOT NULL DEFAULT 'bootstrap'
  CHECK (install_source IN ('bootstrap', 'pack', 'byo', 'manual'));

-- Enabled/disabled toggle — allows users to disable skills without deleting
ALTER TABLE brain_manifest
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT true;

-- Quality score for BYO skills (null for core skills)
ALTER TABLE brain_manifest
  ADD COLUMN IF NOT EXISTS quality_score NUMERIC(3,2)
  CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1));

-- Index for pack-based queries
CREATE INDEX IF NOT EXISTS idx_brain_manifest_skill_pack
  ON brain_manifest (skill_pack_id)
  WHERE skill_pack_id IS NOT NULL;

-- Index for enabled skills filtering
CREATE INDEX IF NOT EXISTS idx_brain_manifest_enabled
  ON brain_manifest (workspace_id, is_enabled, category);

-- =========================================================================
-- 2. Create skill_packs table
-- =========================================================================

CREATE TABLE IF NOT EXISTS skill_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Unique slug for URL-safe identification (e.g. 'devops-essentials')
  slug TEXT NOT NULL UNIQUE,

  -- Display name (e.g. 'DevOps Essentials')
  name TEXT NOT NULL,

  -- Rich description of what the pack provides
  description TEXT NOT NULL,

  -- Category for browsing: workflow, devops, research, content, integration, custom
  pack_category TEXT NOT NULL CHECK (pack_category IN (
    'workflow', 'devops', 'research', 'content', 'integration', 'custom'
  )),

  -- Minimum plan required to install this pack (maps to billing plans)
  min_tier TEXT NOT NULL DEFAULT 'builder'
    CHECK (min_tier IN ('builder', 'pro', 'unlimited')),

  -- Version (semver)
  version TEXT NOT NULL DEFAULT '1.0.0',

  -- Author: 'celune' for official packs, org_id for community
  author TEXT NOT NULL DEFAULT 'celune',

  -- Icon identifier for UI rendering
  icon TEXT,

  -- Tags for search and filtering
  tags TEXT[] DEFAULT '{}',

  -- Whether this pack is published and visible in the marketplace
  is_published BOOLEAN NOT NULL DEFAULT false,

  -- Whether this is an official Celune-curated pack
  is_official BOOLEAN NOT NULL DEFAULT true,

  -- Number of installs (denormalized counter)
  install_count INTEGER NOT NULL DEFAULT 0,

  -- JSON array of skill paths included in this pack
  -- Each entry: { path, category, tier, description, version }
  skill_entries JSONB NOT NULL DEFAULT '[]',

  -- JSON object with team_type -> priority mapping for onboarding
  -- e.g. { "web-app": 1, "ai-ml": 2, "fullstack": 1 }
  team_type_affinity JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_skill_packs_category
  ON skill_packs (pack_category, is_published);

CREATE INDEX IF NOT EXISTS idx_skill_packs_tier
  ON skill_packs (min_tier, is_published);

CREATE INDEX IF NOT EXISTS idx_skill_packs_tags
  ON skill_packs USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_skill_packs_team_affinity
  ON skill_packs USING GIN (team_type_affinity);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_skill_packs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_skill_packs_updated_at
  BEFORE UPDATE ON skill_packs
  FOR EACH ROW
  EXECUTE FUNCTION update_skill_packs_updated_at();

-- =========================================================================
-- 3. Skill pack installs tracking (many-to-many: workspace <-> pack)
-- =========================================================================

CREATE TABLE IF NOT EXISTS skill_pack_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_pack_id UUID NOT NULL REFERENCES skill_packs(id) ON DELETE CASCADE,
  installed_by UUID NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version_installed TEXT NOT NULL,
  UNIQUE (workspace_id, skill_pack_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_pack_installs_workspace
  ON skill_pack_installs (workspace_id);

-- =========================================================================
-- 4. Add FK from brain_manifest to skill_packs
-- =========================================================================

ALTER TABLE brain_manifest
  ADD CONSTRAINT fk_brain_manifest_skill_pack
  FOREIGN KEY (skill_pack_id) REFERENCES skill_packs(id) ON DELETE SET NULL;

-- =========================================================================
-- 5. RLS for skill_packs (public read, admin write)
-- =========================================================================

ALTER TABLE skill_packs ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can browse published packs
CREATE POLICY skill_packs_select ON skill_packs
  FOR SELECT USING (is_published = true);

-- Only service role can insert/update/delete (managed via API)
-- No user-level write policies needed — all writes go through service client

-- =========================================================================
-- 6. RLS for skill_pack_installs
-- =========================================================================

ALTER TABLE skill_pack_installs ENABLE ROW LEVEL SECURITY;

-- Workspace members can see their installs
CREATE POLICY skill_pack_installs_select ON skill_pack_installs
  FOR SELECT USING (
    workspace_id IN (
      SELECT wm.workspace_id
      FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- Workspace admins/owners can manage installs
CREATE POLICY skill_pack_installs_insert ON skill_pack_installs
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT wm.workspace_id
      FROM workspace_memberships wm
      JOIN roles r ON r.id = wm.role_id
      WHERE wm.user_id = auth.uid()
        AND r.slug IN ('owner', 'admin')
    )
  );

CREATE POLICY skill_pack_installs_delete ON skill_pack_installs
  FOR DELETE USING (
    workspace_id IN (
      SELECT wm.workspace_id
      FROM workspace_memberships wm
      JOIN roles r ON r.id = wm.role_id
      WHERE wm.user_id = auth.uid()
        AND r.slug IN ('owner', 'admin')
    )
  );
