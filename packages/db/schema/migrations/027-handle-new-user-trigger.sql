-- 027-handle-new-user-trigger.sql
-- P1: Auto-assign 'member' role on self-signup + backfill audit
-- Creates a trigger on auth.users that inserts a user_roles row with role='member'
-- for every new signup. Also backfills any existing auth.users missing a user_roles row.
-- Depends on: 024-user-roles.sql

-- ============================================================
-- Step 1: Backfill audit — find auth.users with no user_roles row
-- and insert 'member' role for them
-- ============================================================

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'member'::user_role
FROM auth.users u
LEFT JOIN public.user_roles ur ON ur.user_id = u.id
WHERE ur.id IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- Step 2: Verify no orphaned rows in user_id tables
-- These tables have NOT NULL + FK constraints from migrations 021/022,
-- so orphaned rows are structurally impossible. This query is included
-- as a safety audit (uncomment to run manually):
-- ============================================================

-- SELECT 'projects' AS tbl, COUNT(*) AS orphaned FROM projects p
--   LEFT JOIN auth.users u ON u.id = p.user_id WHERE u.id IS NULL
-- UNION ALL SELECT 'tasks', COUNT(*) FROM tasks t
--   LEFT JOIN auth.users u ON u.id = t.user_id WHERE u.id IS NULL
-- UNION ALL SELECT 'project_groups', COUNT(*) FROM project_groups pg
--   LEFT JOIN auth.users u ON u.id = pg.user_id WHERE u.id IS NULL
-- UNION ALL SELECT 'activity_log', COUNT(*) FROM activity_log al
--   LEFT JOIN auth.users u ON u.id = al.user_id WHERE u.id IS NULL
-- UNION ALL SELECT 'task_comments', COUNT(*) FROM task_comments tc
--   LEFT JOIN auth.users u ON u.id = tc.user_id WHERE u.id IS NULL
-- UNION ALL SELECT 'agent_status', COUNT(*) FROM agent_status ast
--   LEFT JOIN auth.users u ON u.id = ast.user_id WHERE u.id IS NULL
-- UNION ALL SELECT 'agent_configs', COUNT(*) FROM agent_configs ac
--   LEFT JOIN auth.users u ON u.id = ac.user_id WHERE u.id IS NULL
-- UNION ALL SELECT 'agent_memory', COUNT(*) FROM agent_memory am
--   LEFT JOIN auth.users u ON u.id = am.user_id WHERE u.id IS NULL
-- UNION ALL SELECT 'cron_jobs', COUNT(*) FROM cron_jobs cj
--   LEFT JOIN auth.users u ON u.id = cj.user_id WHERE u.id IS NULL;

-- ============================================================
-- Step 3: Create trigger function for new signups
-- SECURITY DEFINER so it can insert into user_roles regardless of RLS
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'member')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Step 4: Attach trigger to auth.users
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
