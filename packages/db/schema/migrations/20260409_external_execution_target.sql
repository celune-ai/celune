-- Migration: Add 'external' execution target type for second-brain bridge
-- Allows local /build sprints to write execution events to Celune's dashboard
-- without requiring a task_id or project_id

-- 1. Add 'external' to the execution_target enum
ALTER TYPE execution_target ADD VALUE IF NOT EXISTS 'external';

-- 2. Replace the target check constraint to allow external with null task/project
ALTER TABLE execution_queue DROP CONSTRAINT IF EXISTS execution_queue_target_check;
ALTER TABLE execution_queue ADD CONSTRAINT execution_queue_target_check CHECK (
  (target_type = 'task'     AND task_id    IS NOT NULL) OR
  (target_type = 'project'  AND project_id IS NOT NULL) OR
  (target_type = 'external')
);

-- Rollback:
-- ALTER TABLE execution_queue DROP CONSTRAINT IF EXISTS execution_queue_target_check;
-- ALTER TABLE execution_queue ADD CONSTRAINT execution_queue_target_check CHECK (
--   (target_type = 'task'    AND task_id    IS NOT NULL) OR
--   (target_type = 'project' AND project_id IS NOT NULL)
-- );
-- Note: PostgreSQL does not support removing enum values directly.
-- To remove 'external', you must recreate the enum type.
