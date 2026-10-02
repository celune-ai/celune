-- Add indexes on org_id for projects and tasks tables.
-- These are critical for RLS policy performance — every authenticated
-- query filters by org_id, and without indexes this causes sequential scans.

CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON tasks(org_id);

-- Rollback:
-- DROP INDEX IF EXISTS idx_projects_org_id;
-- DROP INDEX IF EXISTS idx_tasks_org_id;
