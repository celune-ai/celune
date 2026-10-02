-- Add ownership_scope to brain_manifest for three-tier component ownership:
--   core      = Platform-provided, auto-updated by Celune
--   org       = Org-level shared, created by org admins, inherited by team workspaces
--   workspace = User-owned, never auto-updated
--
-- Part of: Second Brain Enterprise Patterns

-- 1. Add ownership_scope column (default 'core' matches existing is_core=true behavior)
ALTER TABLE brain_manifest
  ADD COLUMN IF NOT EXISTS ownership_scope TEXT NOT NULL DEFAULT 'core'
  CHECK (ownership_scope IN ('core', 'org', 'workspace'));

-- 2. Add org_id for org-scoped entries (nullable — only set for org-owned components)
ALTER TABLE brain_manifest
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- 3. Backfill: set ownership_scope based on is_core flag
UPDATE brain_manifest SET ownership_scope = 'core' WHERE is_core = true;
UPDATE brain_manifest SET ownership_scope = 'workspace' WHERE is_core = false;

-- 4. Index for org-scoped queries (find all org entries for inheritance)
CREATE INDEX IF NOT EXISTS idx_brain_manifest_org_scope
  ON brain_manifest (org_id, ownership_scope)
  WHERE org_id IS NOT NULL;

-- 5. Index for ownership scope filtering
CREATE INDEX IF NOT EXISTS idx_brain_manifest_workspace_scope
  ON brain_manifest (workspace_id, ownership_scope);

-- 6. Org-scoped manifest RLS: org members can read org-level entries
-- (existing policies cover workspace_id-based access; this extends to org-level)
CREATE POLICY brain_manifest_select_org ON brain_manifest
  FOR SELECT USING (
    org_id IS NOT NULL AND org_id IN (
      SELECT om.org_id
      FROM org_memberships om
      WHERE om.user_id = auth.uid()
    )
  );

-- 7. Only org owners/admins can manage org-scoped entries
CREATE POLICY brain_manifest_insert_org ON brain_manifest
  FOR INSERT WITH CHECK (
    ownership_scope != 'org' OR (
      org_id IN (
        SELECT om.org_id
        FROM org_memberships om
        WHERE om.user_id = auth.uid()
          AND om.role IN ('owner', 'admin')
      )
    )
  );

CREATE POLICY brain_manifest_update_org ON brain_manifest
  FOR UPDATE USING (
    ownership_scope != 'org' OR (
      org_id IN (
        SELECT om.org_id
        FROM org_memberships om
        WHERE om.user_id = auth.uid()
          AND om.role IN ('owner', 'admin')
      )
    )
  );

CREATE POLICY brain_manifest_delete_org ON brain_manifest
  FOR DELETE USING (
    ownership_scope != 'org' OR (
      org_id IN (
        SELECT om.org_id
        FROM org_memberships om
        WHERE om.user_id = auth.uid()
          AND om.role IN ('owner', 'admin')
      )
    )
  );
