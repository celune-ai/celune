-- Performance: add compound indexes for common query patterns
-- Applied to production via execute_sql. Migration file for record.
--
-- tasks: most queries filter workspace_id + status together
-- projects: same pattern
-- activity_log: workspace + created_at for chronological listing
-- tasks.depends_on: GIN index for array containment queries

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status ON tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_workspace_status ON projects(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_activity_log_workspace_created ON activity_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_depends_on ON tasks USING GIN(depends_on);
