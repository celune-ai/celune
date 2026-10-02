-- Migration: Add workspace_id column to project_groups
--
-- Context: project_groups has org_id (migration 20260305) but no workspace_id.
-- The queries.ts getProjectGroups function and RLS policies (20260309) already
-- reference workspace_id, but the column was never created. This migration adds
-- it and backfills from associated projects.
--
-- ROLLBACK:
--   ALTER TABLE project_groups DROP COLUMN IF EXISTS workspace_id;
--   DROP INDEX IF EXISTS idx_project_groups_workspace_id;

-- Step 1: Add workspace_id column
ALTER TABLE project_groups
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;

-- Step 2: Backfill workspace_id from the earliest project in each group
UPDATE project_groups pg
SET workspace_id = sub.workspace_id
FROM (
  SELECT DISTINCT ON (p.group_id)
    p.group_id,
    p.workspace_id
  FROM projects p
  WHERE p.group_id IS NOT NULL
    AND p.workspace_id IS NOT NULL
  ORDER BY p.group_id, p.created_at ASC
) sub
WHERE pg.id = sub.group_id
  AND pg.workspace_id IS NULL;

-- Step 3: Add index for fast workspace lookups
CREATE INDEX IF NOT EXISTS idx_project_groups_workspace_id ON project_groups(workspace_id);
