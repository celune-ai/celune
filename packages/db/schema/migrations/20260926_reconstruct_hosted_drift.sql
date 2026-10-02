-- Migration 20260926_reconstruct_hosted_drift: objects that exist in the hosted
-- project but were created or changed by hand, outside any migration file.
--
-- Source: pg_catalog read of the hosted project on 2026-09-26, diffed against a
-- database booted from supabase-schema.sql plus this directory. Every statement is
-- idempotent; on the hosted project it is a no-op.
--
-- Known differences left in place on purpose (see SCHEMA_TRACKING.md):
--   tasks.workspace_id stays NOT NULL (hosted: nullable); the partial unique index on
--   workspace_invitations stays (hosted: full unique constraint); set_completed_at trigger
--   and activity_log.acknowledged / cron_jobs.user_id stay (hosted dropped them by hand).

-- ============================================================
-- 1. Columns
-- ============================================================

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id);

-- Existing rows take the owner of their task; NOT NULL is set once no row is left empty.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'task_attachments' AND column_name = 'user_id') THEN
    ALTER TABLE task_attachments
      ADD COLUMN user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
    UPDATE task_attachments a SET user_id = t.user_id FROM tasks t WHERE t.id = a.task_id;
    IF EXISTS (SELECT 1 FROM task_attachments WHERE user_id IS NULL) THEN
      RAISE NOTICE 'task_attachments.user_id left nullable: some rows have no task owner';
    ELSE
      ALTER TABLE task_attachments ALTER COLUMN user_id SET NOT NULL;
    END IF;
  END IF;
END $$;

-- Owner defaults so inserts through PostgREST carry the caller's id.
ALTER TABLE tasks          ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE projects       ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE task_comments  ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE agent_configs  ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE project_groups ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE activity_log   ALTER COLUMN user_id SET DEFAULT auth.uid(), ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE agent_memory   ALTER COLUMN user_id SET DEFAULT auth.uid(), ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE agent_status   ALTER COLUMN user_id SET DEFAULT auth.uid(), ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'depends_on') = 'YES' THEN
    UPDATE tasks SET depends_on = '{}' WHERE depends_on IS NULL;
    ALTER TABLE tasks ALTER COLUMN depends_on SET NOT NULL;
  END IF;
END $$;

-- projects.project_type and projects.priority are enum columns on the hosted project;
-- the base schema declares them as text, which made 017 and 20260304 no-ops.
-- The 'system' enum value is added in 20260926_project_type_system_value.sql, because a
-- new enum value cannot be used in the transaction that adds it.

DO $$
BEGIN
  IF (SELECT udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'project_type') = 'text' THEN
    ALTER TABLE projects ALTER COLUMN project_type DROP DEFAULT;
    ALTER TABLE projects ALTER COLUMN project_type TYPE project_type
      USING (CASE WHEN project_type IN ('feature', 'improvement', 'research', 'plan', 'system')
                  THEN project_type ELSE 'feature' END)::project_type;
    ALTER TABLE projects ALTER COLUMN project_type SET DEFAULT 'feature'::project_type;
    ALTER TABLE projects ALTER COLUMN project_type SET NOT NULL;
  END IF;
  IF (SELECT udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'priority') = 'text' THEN
    ALTER TABLE projects ALTER COLUMN priority DROP DEFAULT;
    ALTER TABLE projects ALTER COLUMN priority TYPE project_priority
      USING (CASE WHEN priority IN ('low', 'medium', 'high', 'urgent') THEN priority ELSE 'medium' END)::project_priority;
    ALTER TABLE projects ALTER COLUMN priority SET DEFAULT 'medium'::project_priority;
    ALTER TABLE projects ALTER COLUMN priority SET NOT NULL;
  END IF;
END $$;

-- ============================================================
-- 2. Constraints (the base schema declares these columns without references)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_user_id_fkey') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_org_id_fkey') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_workspace_id_fkey') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_user_id_fkey') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_org_id_fkey') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_workspace_id_fkey') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_group_id_fkey') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_group_id_fkey FOREIGN KEY (group_id) REFERENCES project_groups(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_log_actor_user_id_fkey') THEN
    ALTER TABLE activity_log ADD CONSTRAINT activity_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_log_workspace_id_fkey') THEN
    ALTER TABLE activity_log ADD CONSTRAINT activity_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_comments_workspace_id_fkey') THEN
    ALTER TABLE task_comments ADD CONSTRAINT task_comments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_org_id_fkey') THEN
    ALTER TABLE user_roles ADD CONSTRAINT user_roles_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_workspace_id_fkey') THEN
    ALTER TABLE feedback ADD CONSTRAINT feedback_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_effort_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_effort_check CHECK (effort IN ('S', 'M', 'L'));
  END IF;
END $$;

-- ============================================================
-- 3. Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_activity_log_workspace     ON activity_log (workspace_id);
CREATE INDEX IF NOT EXISTS idx_claude_usage_user_id       ON claude_usage (user_id);
CREATE INDEX IF NOT EXISTS idx_projects_sort_order        ON projects (sort_order);
CREATE INDEX IF NOT EXISTS idx_projects_workspace_type    ON projects (workspace_id, project_type);
CREATE INDEX IF NOT EXISTS idx_task_attachments_user_id   ON task_attachments (user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_workspace    ON task_comments (workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_project    ON tasks (workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_is_active       ON user_roles (user_id) WHERE is_active = false;
CREATE INDEX IF NOT EXISTS idx_waitlist_referral_code     ON waitlist (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_waitlist_referred_by       ON waitlist (referred_by) WHERE referred_by IS NOT NULL;

-- ============================================================
-- 4. Policies
-- ============================================================

-- 023 user-scoped policies were removed from the hosted project once workspace
-- scoping landed; they widen access beyond the workspace policies.
DROP POLICY IF EXISTS activity_log_select_user   ON activity_log;
DROP POLICY IF EXISTS activity_log_insert_user   ON activity_log;
DROP POLICY IF EXISTS activity_log_update_user   ON activity_log;
DROP POLICY IF EXISTS activity_log_delete_user   ON activity_log;
DROP POLICY IF EXISTS agent_configs_select_user  ON agent_configs;
DROP POLICY IF EXISTS agent_configs_insert_user  ON agent_configs;
DROP POLICY IF EXISTS agent_configs_update_user  ON agent_configs;
DROP POLICY IF EXISTS agent_configs_delete_user  ON agent_configs;
DROP POLICY IF EXISTS agent_status_select_user   ON agent_status;
DROP POLICY IF EXISTS agent_status_insert_user   ON agent_status;
DROP POLICY IF EXISTS agent_status_update_user   ON agent_status;
DROP POLICY IF EXISTS agent_status_delete_user   ON agent_status;
DROP POLICY IF EXISTS cron_jobs_select_user      ON cron_jobs;
DROP POLICY IF EXISTS cron_jobs_insert_user      ON cron_jobs;
DROP POLICY IF EXISTS cron_jobs_update_user      ON cron_jobs;
DROP POLICY IF EXISTS cron_jobs_delete_user      ON cron_jobs;
DROP POLICY IF EXISTS project_groups_select_user ON project_groups;
DROP POLICY IF EXISTS project_groups_insert_user ON project_groups;
DROP POLICY IF EXISTS project_groups_update_user ON project_groups;
DROP POLICY IF EXISTS project_groups_delete_user ON project_groups;
DROP POLICY IF EXISTS projects_select_user       ON projects;
DROP POLICY IF EXISTS projects_insert_user       ON projects;
DROP POLICY IF EXISTS projects_update_user       ON projects;
DROP POLICY IF EXISTS projects_delete_user       ON projects;
DROP POLICY IF EXISTS tasks_select_user          ON tasks;
DROP POLICY IF EXISTS tasks_insert_user          ON tasks;
DROP POLICY IF EXISTS tasks_update_user          ON tasks;
DROP POLICY IF EXISTS tasks_delete_user          ON tasks;
DROP POLICY IF EXISTS "Service role full access on claude_usage"     ON claude_usage;
DROP POLICY IF EXISTS "Service role full access on task_attachments" ON task_attachments;
DROP POLICY IF EXISTS service_role_insert_execution_logs             ON execution_logs;
DROP POLICY IF EXISTS knowledge_sources_select_workspace             ON knowledge_sources;

DROP POLICY IF EXISTS agent_configs_insert_org ON agent_configs;
CREATE POLICY agent_configs_insert_org ON agent_configs
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT w.id FROM workspaces w WHERE w.org_id IN (SELECT user_org_ids())));

DROP POLICY IF EXISTS agent_status_insert_org ON agent_status;
CREATE POLICY agent_status_insert_org ON agent_status
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT w.id FROM workspaces w WHERE w.org_id IN (SELECT user_org_ids())));

DROP POLICY IF EXISTS task_comments_insert_org ON task_comments;
CREATE POLICY task_comments_insert_org ON task_comments
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT w.id FROM workspaces w WHERE w.org_id IN (SELECT user_org_ids())));

DROP POLICY IF EXISTS task_attachments_select_user ON task_attachments;
CREATE POLICY task_attachments_select_user ON task_attachments
  FOR SELECT USING (auth.uid() = user_id OR is_owner());
DROP POLICY IF EXISTS task_attachments_insert_user ON task_attachments;
CREATE POLICY task_attachments_insert_user ON task_attachments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS task_attachments_update_user ON task_attachments;
CREATE POLICY task_attachments_update_user ON task_attachments
  FOR UPDATE USING (auth.uid() = user_id OR is_owner());
DROP POLICY IF EXISTS task_attachments_delete_user ON task_attachments;
CREATE POLICY task_attachments_delete_user ON task_attachments
  FOR DELETE USING (auth.uid() = user_id OR is_owner());

DROP POLICY IF EXISTS feedback_insert ON feedback;
CREATE POLICY feedback_insert ON feedback FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS feedback_read ON feedback;
CREATE POLICY feedback_read ON feedback
  FOR SELECT USING (workspace_id IN (SELECT wm.workspace_id FROM workspace_memberships wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS conversation_logs_insert ON conversation_logs;
CREATE POLICY conversation_logs_insert ON conversation_logs FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS conversation_logs_read ON conversation_logs;
CREATE POLICY conversation_logs_read ON conversation_logs
  FOR SELECT USING (workspace_id IN (SELECT wm.workspace_id FROM workspace_memberships wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS conversation_messages_insert ON conversation_messages;
CREATE POLICY conversation_messages_insert ON conversation_messages FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS conversation_messages_read ON conversation_messages;
CREATE POLICY conversation_messages_read ON conversation_messages
  FOR SELECT USING (conversation_id IN (
    SELECT cl.id FROM conversation_logs cl
    WHERE cl.workspace_id IN (SELECT wm.workspace_id FROM workspace_memberships wm WHERE wm.user_id = auth.uid())
  ));

DROP POLICY IF EXISTS "Service role full access on device_auth_codes" ON device_auth_codes;
CREATE POLICY "Service role full access on device_auth_codes" ON device_auth_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS org_members_select_org_staff ON org_members;
CREATE POLICY org_members_select_org_staff ON org_members
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM org_members om JOIN roles r ON r.id = om.role_id
    WHERE om.org_id = org_members.org_id
      AND om.user_id = auth.uid()
      AND om.is_active = true
      AND (om.is_owner = true OR r.slug = 'admin')
  ));

DROP POLICY IF EXISTS org_members_service_all ON org_members;
CREATE POLICY org_members_service_all ON org_members
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Workspace members can view slack connections" ON slack_connections;
CREATE POLICY "Workspace members can view slack connections" ON slack_connections
  FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids(auth.uid())));

-- ============================================================
-- 5. Functions (bodies copied from the hosted project)
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_unblock_dependents()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  dep_task RECORD;
  all_done BOOLEAN;
  dep_id UUID;
  new_metadata JSONB;
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
        new_metadata := COALESCE(dep_task.metadata, '{}'::jsonb);
        -- Safely remove blocked keys only if they exist
        IF new_metadata ? 'blocked_reason' THEN
          new_metadata := new_metadata - 'blocked_reason';
        END IF;
        IF new_metadata ? 'blocked_by' THEN
          new_metadata := new_metadata - 'blocked_by';
        END IF;
        IF new_metadata ? 'blocked_at' THEN
          new_metadata := new_metadata - 'blocked_at';
        END IF;
        IF new_metadata ? 'blocked' THEN
          new_metadata := new_metadata - 'blocked';
        END IF;

        UPDATE tasks
        SET metadata = new_metadata,
            updated_at = NOW()
        WHERE id = dep_task.id;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_users_by_ids(user_ids uuid[])
 RETURNS TABLE(id uuid, email text, display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT
    u.id,
    u.email,
    (u.raw_user_meta_data->>'display_name')::text AS display_name
  FROM auth.users u
  WHERE u.id = ANY(user_ids)
    AND (
      -- service_role bypass (explicit role check, not auth.uid() IS NULL)
      auth.role() = 'service_role'
      OR EXISTS (
        -- Legacy path: org_memberships (no is_active column).
        -- Exclude users explicitly deactivated in org_members to prevent bypass.
        SELECT 1
        FROM org_memberships caller_om
        JOIN org_memberships target_om ON caller_om.org_id = target_om.org_id
        WHERE caller_om.user_id = auth.uid()
          AND target_om.user_id = u.id
          AND NOT EXISTS (
            SELECT 1 FROM org_members deact
            WHERE deact.user_id = auth.uid()
              AND deact.org_id = caller_om.org_id
              AND deact.is_active = false
          )
      )
      OR EXISTS (
        -- RBAC v2 path: org_members with is_active enforcement
        SELECT 1
        FROM org_members caller_om
        JOIN org_members target_om ON caller_om.org_id = target_om.org_id
        WHERE caller_om.user_id = auth.uid()
          AND caller_om.is_active = true
          AND target_om.user_id = u.id
          AND target_om.is_active = true
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_invitation_user(p_user_id uuid)
 RETURNS TABLE(id uuid, email text, invited_at timestamp with time zone, confirmed_at timestamp with time zone, invited_role text, banned_until timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    u.id,
    u.email,
    u.invited_at,
    u.email_confirmed_at   AS confirmed_at,
    (u.raw_user_meta_data->>'invited_role')::text AS invited_role,
    u.banned_until
  FROM auth.users u
  WHERE u.id = p_user_id
    AND (
      auth.role() = 'service_role'
      OR EXISTS (
        -- Legacy path with deactivation guard
        SELECT 1 FROM org_memberships om
        WHERE om.user_id = u.id
          AND om.org_id IN (
            SELECT org_id FROM org_memberships WHERE user_id = auth.uid()
          )
          AND NOT EXISTS (
            SELECT 1 FROM org_members deact
            WHERE deact.user_id = auth.uid()
              AND deact.org_id = om.org_id
              AND deact.is_active = false
          )
      )
      OR EXISTS (
        SELECT 1 FROM org_members om
        WHERE om.user_id = u.id
          AND om.is_active = true
          AND om.org_id IN (
            SELECT org_id FROM org_members WHERE user_id = auth.uid() AND is_active = true
          )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_invitations()
 RETURNS TABLE(id uuid, email text, invited_at timestamp with time zone, created_at timestamp with time zone, invited_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT
    u.id,
    u.email,
    u.invited_at,
    u.created_at,
    (u.raw_user_meta_data->>'invited_role')::text AS invited_role
  FROM auth.users u
  WHERE u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND (
      auth.role() = 'service_role'
      OR EXISTS (
        -- Legacy path with deactivation guard
        SELECT 1 FROM org_memberships om
        WHERE om.user_id = u.id
          AND om.org_id IN (
            SELECT org_id FROM org_memberships WHERE user_id = auth.uid()
          )
          AND NOT EXISTS (
            SELECT 1 FROM org_members deact
            WHERE deact.user_id = auth.uid()
              AND deact.org_id = om.org_id
              AND deact.is_active = false
          )
      )
      OR EXISTS (
        SELECT 1 FROM org_members om
        WHERE om.user_id = u.id
          AND om.is_active = true
          AND om.org_id IN (
            SELECT org_id FROM org_members WHERE user_id = auth.uid() AND is_active = true
          )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.increment_referral_count(p_referral_code text, p_threshold integer DEFAULT 2)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Atomic increment + priority upgrade
  UPDATE public.waitlist
  SET referral_count = referral_count + 1,
      priority = CASE WHEN referral_count + 1 >= p_threshold THEN true ELSE priority END,
      updated_at = now()
  WHERE referral_code = p_referral_code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.exec_sql(query text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  EXECUTE query;
  result := json_build_object('success', true);
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- exec_sql runs arbitrary SQL (scripts/migrate.mjs uses it); only the service role may call it.
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;
