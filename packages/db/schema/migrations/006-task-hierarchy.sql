-- 006-task-hierarchy.sql
-- Adds parent/child task hierarchy and agent delegation support.
-- Converts assignee from enum to text (supports 12+ agent IDs).

-- Step 1: Convert assignee enum → text
ALTER TABLE tasks ADD COLUMN assignee_text text;
UPDATE tasks SET assignee_text = assignee::text;
ALTER TABLE tasks DROP COLUMN assignee;
ALTER TABLE tasks RENAME COLUMN assignee_text TO assignee;
ALTER TABLE tasks ALTER COLUMN assignee SET DEFAULT 'unassigned';
ALTER TABLE tasks ALTER COLUMN assignee SET NOT NULL;
DROP TYPE IF EXISTS task_assignee;

-- Step 2: Add hierarchy columns
ALTER TABLE tasks ADD COLUMN parent_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN spawned_by text;

-- Step 3: Indexes
CREATE INDEX idx_tasks_parent_id ON tasks(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_tasks_spawned_by ON tasks(spawned_by) WHERE spawned_by IS NOT NULL;

-- Step 4: Rename claude → rick in agent_configs (if row exists)
UPDATE agent_configs SET agent_id = 'rick' WHERE agent_id = 'claude';
