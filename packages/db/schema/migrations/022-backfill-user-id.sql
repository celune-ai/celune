-- 022-backfill-user-id.sql
-- P0: Data backfill — assign owner UID to existing rows
-- Runs after 021-user-id-columns.sql. Backfills all existing data with the
-- platform owner's auth UID, then sets user_id to NOT NULL.
--
-- IMPORTANT: Replace '<OWNER_UID>' with the actual auth.users UUID before running.
-- To find it: SELECT id FROM auth.users LIMIT 1;
--
-- ROLLBACK:
--   ALTER TABLE projects ALTER COLUMN user_id DROP NOT NULL;
--   ALTER TABLE tasks ALTER COLUMN user_id DROP NOT NULL;
--   ALTER TABLE project_groups ALTER COLUMN user_id DROP NOT NULL;
--   ALTER TABLE activity_log ALTER COLUMN user_id DROP NOT NULL;
--   ALTER TABLE task_comments ALTER COLUMN user_id DROP NOT NULL;
--   ALTER TABLE agent_status ALTER COLUMN user_id DROP NOT NULL;
--   ALTER TABLE agent_configs ALTER COLUMN user_id DROP NOT NULL;
--   ALTER TABLE agent_memory ALTER COLUMN user_id DROP NOT NULL;
--   ALTER TABLE cron_jobs ALTER COLUMN user_id DROP NOT NULL;

-- ============================================
-- Step 1: Backfill all rows with the owner's UID
-- Uses a DO block to look up the owner dynamically
-- ============================================

DO $$
DECLARE
  owner_uid uuid;
BEGIN
  -- Get the first (and currently only) auth user
  SELECT id INTO owner_uid FROM auth.users ORDER BY created_at ASC LIMIT 1;

  -- A fresh database has no users yet; there is nothing to backfill.
  IF owner_uid IS NULL THEN
    RAISE NOTICE 'No auth user found; skipping user_id backfill';
    RETURN;
  END IF;

  RAISE NOTICE 'Backfilling user_id with owner UID: %', owner_uid;

  -- Backfill each table
  UPDATE projects SET user_id = owner_uid WHERE user_id IS NULL;
  UPDATE tasks SET user_id = owner_uid WHERE user_id IS NULL;
  UPDATE project_groups SET user_id = owner_uid WHERE user_id IS NULL;
  UPDATE activity_log SET user_id = owner_uid WHERE user_id IS NULL;
  UPDATE task_comments SET user_id = owner_uid WHERE user_id IS NULL;
  UPDATE agent_status SET user_id = owner_uid WHERE user_id IS NULL;
  UPDATE agent_configs SET user_id = owner_uid WHERE user_id IS NULL;
  UPDATE agent_memory SET user_id = owner_uid WHERE user_id IS NULL;
  UPDATE cron_jobs SET user_id = owner_uid WHERE user_id IS NULL;
END $$;

-- ============================================
-- Step 2: Set NOT NULL constraints
-- Only safe after all rows are backfilled. A table that still holds NULL
-- rows (seeded cron_jobs on a database with no users) keeps the column
-- nullable and reports it.
-- ============================================

DO $$
DECLARE
  tbl text;
  null_count integer;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'projects', 'tasks', 'project_groups', 'activity_log', 'task_comments',
    'agent_status', 'agent_configs', 'agent_memory', 'cron_jobs'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE user_id IS NULL', tbl) INTO null_count;
    IF null_count = 0 THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN user_id SET NOT NULL', tbl);
    ELSE
      RAISE NOTICE '%.user_id left nullable: % rows have no owner', tbl, null_count;
    END IF;
  END LOOP;
END $$;

-- ============================================
-- Step 3: Verify — should return zero rows
-- ============================================

-- SELECT 'projects' AS tbl, COUNT(*) AS null_count FROM projects WHERE user_id IS NULL
-- UNION ALL SELECT 'tasks', COUNT(*) FROM tasks WHERE user_id IS NULL
-- UNION ALL SELECT 'project_groups', COUNT(*) FROM project_groups WHERE user_id IS NULL
-- UNION ALL SELECT 'activity_log', COUNT(*) FROM activity_log WHERE user_id IS NULL
-- UNION ALL SELECT 'task_comments', COUNT(*) FROM task_comments WHERE user_id IS NULL
-- UNION ALL SELECT 'agent_status', COUNT(*) FROM agent_status WHERE user_id IS NULL
-- UNION ALL SELECT 'agent_configs', COUNT(*) FROM agent_configs WHERE user_id IS NULL
-- UNION ALL SELECT 'agent_memory', COUNT(*) FROM agent_memory WHERE user_id IS NULL
-- UNION ALL SELECT 'cron_jobs', COUNT(*) FROM cron_jobs WHERE user_id IS NULL;
