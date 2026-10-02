-- Rename task_status enum value 'assigned' → 'scoping'
-- This aligns the internal value with the UI label "Scoping"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'task_status' AND e.enumlabel = 'assigned'
  ) THEN
    ALTER TYPE task_status RENAME VALUE 'assigned' TO 'scoping';
  END IF;
END $$;
