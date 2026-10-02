-- Tenant scoping for four RLS policy sets the isolation suite found open across workspaces.
--
-- task_attachments and claude_usage admitted any row to public.is_owner(), which is true
-- for anyone who owns any org, and every self-signup user owns one. A signed-in user could
-- read, change, and delete another workspace's attachment rows through PostgREST.
-- Attachments are now scoped through the parent task's workspace, and claude_usage through
-- the row's workspace. The attachment insert policy also checks the task's workspace, since
-- user_id = auth.uid() alone let a user attach a row to another workspace's task.
--
-- slack_connections kept is_owner() inside a workspace-membership check, so the owner of an
-- unrelated org could manage connections in any workspace they joined as a member. The
-- manage policy now needs settings:manage in that workspace (settings:write, which the old
-- policy named, is not a permission key).
--
-- agent_status select, update, delete, and modify policies admitted rows with a NULL
-- workspace_id to every caller; two of them had no role, so anon too. Those branches are
-- gone; the service role keeps full access and no user-facing query reads NULL rows.
--
-- anon has no use for any of these tables, so its grants are revoked; RLS was its only barrier.

-- task_attachments ----------------------------------------------------------------------------

DROP POLICY IF EXISTS task_attachments_select_user ON public.task_attachments;
DROP POLICY IF EXISTS task_attachments_update_user ON public.task_attachments;
DROP POLICY IF EXISTS task_attachments_delete_user ON public.task_attachments;
DROP POLICY IF EXISTS task_attachments_insert_user ON public.task_attachments;

CREATE POLICY task_attachments_select_workspace ON public.task_attachments
  FOR SELECT TO authenticated
  USING (task_id IN (
    SELECT t.id FROM public.tasks t
    WHERE t.workspace_id IN (SELECT public.user_workspace_ids(auth.uid()))
  ));

CREATE POLICY task_attachments_insert_workspace ON public.task_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND task_id IN (
      SELECT t.id FROM public.tasks t
      WHERE t.workspace_id IN (SELECT public.user_workspace_ids(auth.uid()))
    )
  );

CREATE POLICY task_attachments_update_workspace ON public.task_attachments
  FOR UPDATE TO authenticated
  USING (task_id IN (
    SELECT t.id FROM public.tasks t
    WHERE t.workspace_id IN (SELECT public.user_workspace_ids(auth.uid()))
  ))
  WITH CHECK (task_id IN (
    SELECT t.id FROM public.tasks t
    WHERE t.workspace_id IN (SELECT public.user_workspace_ids(auth.uid()))
  ));

CREATE POLICY task_attachments_delete_workspace ON public.task_attachments
  FOR DELETE TO authenticated
  USING (task_id IN (
    SELECT t.id FROM public.tasks t
    WHERE t.workspace_id IN (SELECT public.user_workspace_ids(auth.uid()))
  ));

REVOKE ALL ON TABLE public.task_attachments FROM anon;

-- claude_usage --------------------------------------------------------------------------------

DROP POLICY IF EXISTS claude_usage_select_user ON public.claude_usage;
DROP POLICY IF EXISTS claude_usage_update_user ON public.claude_usage;
DROP POLICY IF EXISTS claude_usage_delete_user ON public.claude_usage;

-- Own rows stay readable through "Authenticated users read own claude_usage".
CREATE POLICY claude_usage_select_workspace ON public.claude_usage
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT public.user_workspace_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), workspace_id, 'analytics:read')
  );

CREATE POLICY claude_usage_update_own ON public.claude_usage
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND (workspace_id IS NULL OR workspace_id IN (SELECT public.user_workspace_ids(auth.uid())))
  )
  WITH CHECK (
    auth.uid() = user_id
    AND (workspace_id IS NULL OR workspace_id IN (SELECT public.user_workspace_ids(auth.uid())))
  );

CREATE POLICY claude_usage_delete_own ON public.claude_usage
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    AND (workspace_id IS NULL OR workspace_id IN (SELECT public.user_workspace_ids(auth.uid())))
  );

REVOKE ALL ON TABLE public.claude_usage FROM anon;

-- slack_connections ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Workspace admins can manage slack connections" ON public.slack_connections;

CREATE POLICY "Workspace admins can manage slack connections" ON public.slack_connections
  TO authenticated
  USING (
    workspace_id IN (SELECT public.user_workspace_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), workspace_id, 'settings:manage')
  )
  WITH CHECK (
    workspace_id IN (SELECT public.user_workspace_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), workspace_id, 'settings:manage')
  );

REVOKE ALL ON TABLE public.slack_connections FROM anon;

-- agent_status --------------------------------------------------------------------------------

DROP POLICY IF EXISTS agent_status_select_org ON public.agent_status;
DROP POLICY IF EXISTS agent_status_select_ws ON public.agent_status;
DROP POLICY IF EXISTS agent_status_update_org ON public.agent_status;
DROP POLICY IF EXISTS agent_status_delete_org ON public.agent_status;
DROP POLICY IF EXISTS agent_status_modify_ws ON public.agent_status;

CREATE POLICY agent_status_select_org ON public.agent_status
  FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT w.id FROM public.workspaces w
    WHERE w.org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY agent_status_select_ws ON public.agent_status
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM public.workspace_memberships wm WHERE wm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.org_memberships om
      JOIN public.workspaces w ON w.org_id = om.org_id
      WHERE om.user_id = auth.uid() AND om.role = 'owner' AND w.id = agent_status.workspace_id
    )
  );

CREATE POLICY agent_status_update_org ON public.agent_status
  FOR UPDATE TO authenticated
  USING (workspace_id IN (
    SELECT w.id FROM public.workspaces w
    WHERE w.org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY agent_status_delete_org ON public.agent_status
  FOR DELETE TO authenticated
  USING (workspace_id IN (
    SELECT w.id FROM public.workspaces w
    WHERE w.org_id IN (SELECT public.user_admin_org_ids())
  ));

CREATE POLICY agent_status_modify_ws ON public.agent_status
  TO authenticated
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM public.workspace_memberships wm WHERE wm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.org_memberships om
      JOIN public.workspaces w ON w.org_id = om.org_id
      WHERE om.user_id = auth.uid() AND om.role = 'owner' AND w.id = agent_status.workspace_id
    )
  );

REVOKE ALL ON TABLE public.agent_status FROM anon;
