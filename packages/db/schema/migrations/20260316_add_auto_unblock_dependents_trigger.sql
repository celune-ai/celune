-- Auto-unblock dependent tasks when a task completes.
-- When a task moves to 'done', find all tasks that depend on it.
-- If ALL of a dependent task's dependencies are now 'done', clear blocked metadata.

CREATE OR REPLACE FUNCTION auto_unblock_dependents()
RETURNS TRIGGER AS $$
DECLARE
  dep_task RECORD;
  all_done BOOLEAN;
  dep_id UUID;
BEGIN
  -- Only fire when status changes TO 'done'
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    -- Find all tasks that have this task in their depends_on array
    FOR dep_task IN
      SELECT id, depends_on, status, metadata
      FROM tasks
      WHERE depends_on @> ARRAY[NEW.id]::uuid[]
        AND status NOT IN ('done', 'in_progress', 'review')
    LOOP
      -- Check if ALL dependencies for this task are now done
      all_done := TRUE;
      IF dep_task.depends_on IS NOT NULL THEN
        FOR dep_id IN SELECT unnest(dep_task.depends_on)
        LOOP
          IF NOT EXISTS (
            SELECT 1 FROM tasks WHERE id = dep_id AND status = 'done'
          ) THEN
            all_done := FALSE;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      -- If all deps are done, clear blocked state
      IF all_done THEN
        UPDATE tasks
        SET metadata = COALESCE(metadata, '{}'::jsonb)
              - 'blocked_reason' - 'blocked_by' - 'blocked_at',
            updated_at = NOW()
        WHERE id = dep_task.id;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_auto_unblock_dependents ON tasks;
CREATE TRIGGER trg_auto_unblock_dependents
  AFTER UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION auto_unblock_dependents();
