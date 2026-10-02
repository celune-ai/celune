-- Backfill null workspace_id rows across tasks, projects, and project_groups.
-- Associates orphaned entities with the first workspace in their org (or the
-- platform default workspace if no org relationship exists).
--
-- After this migration, API routes treat null workspace_id as a hard deny (403).

-- Step 1: Backfill tasks — use the project's workspace_id where available
UPDATE tasks t
SET workspace_id = p.workspace_id
FROM projects p
WHERE t.project_id = p.id
  AND t.workspace_id IS NULL
  AND p.workspace_id IS NOT NULL;

-- Step 2: Backfill remaining tasks — use the first workspace the task's user belongs to
UPDATE tasks t
SET workspace_id = wm.workspace_id
FROM workspace_memberships wm
WHERE t.user_id = wm.user_id
  AND t.workspace_id IS NULL;

-- Step 3: Backfill projects — use the first workspace the project's user belongs to
UPDATE projects p
SET workspace_id = wm.workspace_id
FROM workspace_memberships wm
WHERE p.user_id = wm.user_id
  AND p.workspace_id IS NULL;

-- Step 4: Backfill project_groups — use the first workspace the group's user belongs to
UPDATE project_groups pg
SET workspace_id = wm.workspace_id
FROM workspace_memberships wm
WHERE pg.user_id = wm.user_id
  AND pg.workspace_id IS NULL;
