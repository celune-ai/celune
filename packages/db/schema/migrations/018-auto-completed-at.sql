-- 018-auto-completed-at.sql
-- Auto-set completed_at when task status transitions to 'done'
-- Clear completed_at when task is reopened (moved away from 'done')

CREATE OR REPLACE FUNCTION set_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Task moving to done: set completed_at if not already set
  IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  END IF;

  -- Task reopened from done: clear completed_at
  IF OLD.status = 'done' AND NEW.status != 'done' THEN
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_completed_at ON tasks;

CREATE TRIGGER trg_set_completed_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_completed_at();

-- Backfill: any existing done tasks missing completed_at
UPDATE tasks
SET completed_at = updated_at
WHERE status = 'done' AND completed_at IS NULL;
