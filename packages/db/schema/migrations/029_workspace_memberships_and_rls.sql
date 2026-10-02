-- Migration: 029_workspace_memberships_and_rls
-- Sprint: Workspace Isolation Sprint 1
-- Tasks:
--   fa2d0f8b — Create workspace_memberships table + user_workspace_ids() function
--   18a69116 — Create workspace-level RLS policies on tasks, projects, activity_log
--   a95ee0a4 — Add is_default uniqueness constraint on workspaces
--
-- Depends on: workspaces, user_roles, org_memberships tables (all exist)
-- Author: RICK
-- Date: 2026-03-05

-- ============================================================
-- TASK fa2d0f8b: Create workspace_memberships table
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id)
);

ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;

-- RLS on workspace_memberships
-- SELECT: users can see only their own rows
DROP POLICY IF EXISTS workspace_memberships_select ON workspace_memberships;
CREATE POLICY workspace_memberships_select ON workspace_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- INSERT: only owner/admin roles can add members
DROP POLICY IF EXISTS workspace_memberships_insert ON workspace_memberships;
CREATE POLICY workspace_memberships_insert ON workspace_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'admin')
        AND ur.is_active = true
        AND ur.org_id IN (
          SELECT w.org_id FROM workspaces w WHERE w.id = workspace_id
        )
    )
  );

-- UPDATE: only owner/admin roles
DROP POLICY IF EXISTS workspace_memberships_update ON workspace_memberships;
CREATE POLICY workspace_memberships_update ON workspace_memberships
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'admin')
        AND ur.is_active = true
        AND ur.org_id IN (
          SELECT w.org_id FROM workspaces w WHERE w.id = workspace_id
        )
    )
  );

-- DELETE: only owner/admin roles
DROP POLICY IF EXISTS workspace_memberships_delete ON workspace_memberships;
CREATE POLICY workspace_memberships_delete ON workspace_memberships
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'admin')
        AND ur.is_active = true
        AND ur.org_id IN (
          SELECT w.org_id FROM workspaces w WHERE w.id = workspace_id
        )
    )
  );

-- ============================================================
-- user_workspace_ids(uid uuid) — SECURITY DEFINER function
-- Returns all workspace IDs accessible to the given user:
--   owner/admin → all workspaces in their org(s)
--   member/viewer → only workspaces in workspace_memberships
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_workspace_ids(uid uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
AS $$
  -- owner/admin: return all workspaces for their org(s)
  SELECT w.id
  FROM workspaces w
  WHERE w.org_id IN (
    SELECT ur.org_id
    FROM user_roles ur
    WHERE ur.user_id = uid
      AND ur.role IN ('owner', 'admin')
      AND ur.is_active = true
  )
  UNION
  -- member/viewer: return only workspaces they are explicitly added to
  SELECT wm.workspace_id
  FROM workspace_memberships wm
  WHERE wm.user_id = uid
    AND NOT EXISTS (
      -- exclude if they already qualify as owner/admin for the workspace's org
      SELECT 1
      FROM user_roles ur2
      JOIN workspaces w2 ON w2.id = wm.workspace_id
      WHERE ur2.user_id = uid
        AND ur2.org_id = w2.org_id
        AND ur2.role IN ('owner', 'admin')
        AND ur2.is_active = true
    );
$$;

-- ============================================================
-- Seed: insert existing org users into all workspaces for their org
-- Uses ON CONFLICT DO NOTHING to be idempotent
-- ============================================================

INSERT INTO workspace_memberships (user_id, workspace_id)
SELECT om.user_id, w.id
FROM org_memberships om
JOIN workspaces w ON w.org_id = om.org_id
ON CONFLICT (user_id, workspace_id) DO NOTHING;


-- ============================================================
-- TASK 18a69116: Workspace-aware RLS on tasks, projects, activity_log
-- Strategy:
--   SELECT: allow rows where workspace_id IN user_workspace_ids(auth.uid())
--           OR workspace_id IS NULL (legacy data)
--           OR (workspace_id is null and org_id matches — for org-level rows)
-- ============================================================

-- ============================================================
-- tasks
-- ============================================================

DROP POLICY IF EXISTS tasks_select_org ON tasks;
DROP POLICY IF EXISTS tasks_select_workspace ON tasks;
CREATE POLICY tasks_select_workspace ON tasks
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS tasks_insert_org ON tasks;
DROP POLICY IF EXISTS tasks_insert_workspace ON tasks;
CREATE POLICY tasks_insert_workspace ON tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS tasks_update_org ON tasks;
DROP POLICY IF EXISTS tasks_update_workspace ON tasks;
CREATE POLICY tasks_update_workspace ON tasks
  FOR UPDATE TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  )
  WITH CHECK (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS tasks_delete_org ON tasks;
DROP POLICY IF EXISTS tasks_delete_workspace ON tasks;
CREATE POLICY tasks_delete_workspace ON tasks
  FOR DELETE TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- ============================================================
-- projects
-- projects has org_id but may also have workspace_id
-- ============================================================

DROP POLICY IF EXISTS projects_select_org ON projects;
DROP POLICY IF EXISTS projects_select_workspace ON projects;
CREATE POLICY projects_select_workspace ON projects
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS projects_insert_org ON projects;
DROP POLICY IF EXISTS projects_insert_workspace ON projects;
CREATE POLICY projects_insert_workspace ON projects
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS projects_update_org ON projects;
DROP POLICY IF EXISTS projects_update_workspace ON projects;
CREATE POLICY projects_update_workspace ON projects
  FOR UPDATE TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  )
  WITH CHECK (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS projects_delete_org ON projects;
DROP POLICY IF EXISTS projects_delete_workspace ON projects;
CREATE POLICY projects_delete_workspace ON projects
  FOR DELETE TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- ============================================================
-- activity_log
-- Already has workspace-aware policies from 028-fix-null-workspace-rls.sql
-- Replace them with user_workspace_ids() approach
-- ============================================================

DROP POLICY IF EXISTS activity_log_select_org ON activity_log;
DROP POLICY IF EXISTS activity_log_select_workspace ON activity_log;
CREATE POLICY activity_log_select_workspace ON activity_log
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS activity_log_insert_org ON activity_log;
DROP POLICY IF EXISTS activity_log_insert_workspace ON activity_log;
CREATE POLICY activity_log_insert_workspace ON activity_log
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS activity_log_update_org ON activity_log;
DROP POLICY IF EXISTS activity_log_update_workspace ON activity_log;
CREATE POLICY activity_log_update_workspace ON activity_log
  FOR UPDATE TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS activity_log_delete_org ON activity_log;
DROP POLICY IF EXISTS activity_log_delete_workspace ON activity_log;
CREATE POLICY activity_log_delete_workspace ON activity_log
  FOR DELETE TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );


-- ============================================================
-- TASK a95ee0a4: Add is_default uniqueness constraint on workspaces
-- Ensures only one workspace can be the default per org
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_one_default_per_org
  ON workspaces(org_id)
  WHERE is_default = true;
