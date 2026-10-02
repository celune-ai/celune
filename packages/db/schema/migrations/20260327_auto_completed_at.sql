-- Auto-set completed_at when task status changes to 'done'
-- Fixes: completed tasks showing 0 in Done section (filtered by completed_at date range)

-- Backfill existing done tasks missing completed_at
UPDATE tasks SET completed_at = updated_at
WHERE status = 'done' AND completed_at IS NULL;

-- Trigger: auto-set completed_at on status → done
CREATE OR REPLACE FUNCTION public.auto_set_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') AND NEW.completed_at IS NULL THEN
    NEW.completed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_auto_completed_at ON public.tasks;
CREATE TRIGGER tasks_auto_completed_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_completed_at();

-- Rollback:
-- DROP TRIGGER IF EXISTS tasks_auto_completed_at ON public.tasks;
-- DROP FUNCTION IF EXISTS public.auto_set_completed_at();
