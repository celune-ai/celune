-- 009: Task dependency system
-- Adds depends_on uuid[] column and auto-blocking trigger

-- Add depends_on column
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on uuid[] NOT NULL DEFAULT '{}';

-- GIN index for array containment queries
CREATE INDEX IF NOT EXISTS idx_tasks_depends_on ON tasks USING GIN (depends_on);

-- Trigger: sync dependency blocked state
-- When depends_on changes: check if all deps are done → if not, auto-block
-- When status changes to done: find tasks that depend on this one and auto-unblock if all deps done
CREATE OR REPLACE FUNCTION sync_dependency_blocked_state()
RETURNS TRIGGER AS $$
DECLARE
  dep_id uuid;
  all_done boolean;
  dependent_task record;
BEGIN
  -- Case 1: depends_on changed on this task — check if it should be blocked
  IF TG_OP = 'UPDATE' AND NEW.depends_on IS DISTINCT FROM OLD.depends_on THEN
    IF array_length(NEW.depends_on, 1) IS NOT NULL AND array_length(NEW.depends_on, 1) > 0 THEN
      SELECT NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = ANY(NEW.depends_on) AND status != 'done'
      ) INTO all_done;

      IF NOT all_done THEN
        -- Auto-block: set blocked metadata
        NEW.metadata = jsonb_set(
          COALESCE(NEW.metadata, '{}'::jsonb),
          '{blocked}', 'true'
        );
        NEW.metadata = jsonb_set(
          NEW.metadata,
          '{blocked_reason}', '"Waiting on dependency"'
        );
        NEW.metadata = jsonb_set(
          NEW.metadata,
          '{blocked_at}', to_jsonb(now()::text)
        );
        NEW.metadata = jsonb_set(
          NEW.metadata,
          '{blocked_by}', '"system"'
        );
      ELSE
        -- All deps are done — clear auto-block if system-blocked
        IF (NEW.metadata->>'blocked_by') = 'system' THEN
          NEW.metadata = NEW.metadata - 'blocked' - 'blocked_at' - 'blocked_reason' - 'blocked_by';
          NEW.metadata = jsonb_set(
            COALESCE(NEW.metadata, '{}'::jsonb),
            '{auto_unblocked_at}', to_jsonb(now()::text)
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Case 2: status changed to done — check downstream tasks
  IF TG_OP = 'UPDATE' AND NEW.status = 'done' AND OLD.status != 'done' THEN
    FOR dependent_task IN
      SELECT id, depends_on, metadata FROM tasks
      WHERE NEW.id = ANY(depends_on)
        AND (metadata->>'blocked_by') = 'system'
    LOOP
      SELECT NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = ANY(dependent_task.depends_on) AND status != 'done'
      ) INTO all_done;

      IF all_done THEN
        UPDATE tasks SET
          metadata = (COALESCE(dependent_task.metadata, '{}'::jsonb)
            - 'blocked' - 'blocked_at' - 'blocked_reason' - 'blocked_by')
            || jsonb_build_object('auto_unblocked_at', now()::text)
        WHERE id = dependent_task.id;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dependency_blocked ON tasks;
CREATE TRIGGER trg_sync_dependency_blocked
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION sync_dependency_blocked_state();
