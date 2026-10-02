-- Workspace hierarchy: add parent_workspace_id for parent/child relationships
-- Main workspace (is_default=true) acts as the org-level parent.
-- Child workspaces reference the Main workspace via parent_workspace_id.

-- 1. Add parent_workspace_id column (nullable self-referential FK)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS parent_workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;

-- 2. Index for fast child lookups
CREATE INDEX IF NOT EXISTS idx_workspaces_parent
  ON workspaces(parent_workspace_id)
  WHERE parent_workspace_id IS NOT NULL;

-- 3. Constraint: Main workspaces (is_default=true) cannot have a parent
ALTER TABLE workspaces
  ADD CONSTRAINT chk_main_no_parent
  CHECK (NOT (is_default = true AND parent_workspace_id IS NOT NULL));

-- 4. Wire existing workspaces: set parent_workspace_id on non-default workspaces
-- pointing to the default workspace within the same org
UPDATE workspaces child
SET parent_workspace_id = parent.id
FROM workspaces parent
WHERE parent.org_id = child.org_id
  AND parent.is_default = true
  AND child.is_default = false
  AND child.parent_workspace_id IS NULL;

-- 5. Helper function: get child workspace IDs for a given Main workspace
CREATE OR REPLACE FUNCTION get_child_workspace_ids(main_ws_id uuid)
RETURNS uuid[] AS $$
  SELECT COALESCE(array_agg(id), '{}')
  FROM workspaces
  WHERE parent_workspace_id = main_ws_id;
$$ LANGUAGE sql STABLE SECURITY INVOKER;
