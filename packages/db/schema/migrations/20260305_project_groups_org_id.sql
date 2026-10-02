-- 20260305_project_groups_org_id.sql
-- Fix project_groups org isolation
--
-- Context: projects and tasks already use org_id + user_org_ids() for RLS.
-- project_groups was missing org_id entirely and its *_org policies still
-- checked user_id = auth.uid(). This migration brings project_groups in line.
--
-- Steps:
--   1. Add org_id column (nullable UUID) to project_groups
--   2. Backfill org_id from associated projects
--   3. Add index on org_id
--   4. Replace *_org policies with org_id IN (SELECT user_org_ids()) checks
--      to match the projects/tasks pattern exactly
--
-- ROLLBACK:
--   ALTER TABLE project_groups DROP COLUMN IF EXISTS org_id;
--   DROP INDEX IF EXISTS idx_project_groups_org_id;
--   DROP POLICY IF EXISTS "project_groups_select_org" ON project_groups;
--   DROP POLICY IF EXISTS "project_groups_insert_org" ON project_groups;
--   DROP POLICY IF EXISTS "project_groups_update_org" ON project_groups;
--   DROP POLICY IF EXISTS "project_groups_delete_org" ON project_groups;
--   -- Re-create user_id-based policies if needed.

-- ============================================
-- Step 1: Add org_id column
-- ============================================
ALTER TABLE project_groups
  ADD COLUMN IF NOT EXISTS org_id uuid;

-- ============================================
-- Step 2: Backfill org_id from associated projects
-- Takes org_id of the earliest project in each group.
-- Groups with no projects (or all-null org_ids) stay null.
-- ============================================
UPDATE project_groups pg
SET org_id = sub.org_id
FROM (
  SELECT DISTINCT ON (p.group_id)
    p.group_id,
    p.org_id
  FROM projects p
  WHERE p.group_id IS NOT NULL
    AND p.org_id IS NOT NULL
  ORDER BY p.group_id, p.created_at ASC
) sub
WHERE pg.id = sub.group_id
  AND pg.org_id IS NULL;

-- ============================================
-- Step 3: Add index for fast org lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_project_groups_org_id ON project_groups(org_id);

-- ============================================
-- Step 4: Update *_org policies to use org_id IN (user_org_ids())
-- Mirrors the exact pattern used by projects and tasks.
-- ============================================
DROP POLICY IF EXISTS "project_groups_select_org" ON project_groups;
DROP POLICY IF EXISTS "project_groups_insert_org" ON project_groups;
DROP POLICY IF EXISTS "project_groups_update_org" ON project_groups;
DROP POLICY IF EXISTS "project_groups_delete_org" ON project_groups;

CREATE POLICY "project_groups_select_org" ON project_groups
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY "project_groups_insert_org" ON project_groups
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT user_org_ids()));

CREATE POLICY "project_groups_update_org" ON project_groups
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT user_org_ids()))
  WITH CHECK (org_id IN (SELECT user_org_ids()));

CREATE POLICY "project_groups_delete_org" ON project_groups
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT user_admin_org_ids()));
