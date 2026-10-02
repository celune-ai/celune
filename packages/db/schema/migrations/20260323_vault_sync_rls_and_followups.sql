-- Follow-up: Replace permissive RLS with tenant-isolated policies on vault_sync_sources

-- 20260323_vault_sync_sources.sql creates the table and sorts after this file; it also
-- carries these policies, so on a fresh database this block is skipped.
DO $rls$
BEGIN
  IF to_regclass('public.vault_sync_sources') IS NULL THEN
    RAISE NOTICE 'vault_sync_sources missing; policies applied by 20260323_vault_sync_sources.sql';
    RETURN;
  END IF;
  EXECUTE $sql$
-- Drop the overly permissive policy
DROP POLICY IF EXISTS vault_sync_sources_service_all ON vault_sync_sources;

-- Workspace members can read their own vault sources
CREATE POLICY vault_sync_sources_select_member
  ON vault_sync_sources FOR SELECT
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- Service role (cron, API routes) can do everything — RLS bypassed by service key,
-- but this policy ensures anon/authenticated roles are properly scoped
CREATE POLICY vault_sync_sources_insert_member
  ON vault_sync_sources FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY vault_sync_sources_update_member
  ON vault_sync_sources FOR UPDATE
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY vault_sync_sources_delete_member
  ON vault_sync_sources FOR DELETE
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );
  $sql$;
END
$rls$;

-- Also create the batch publish RPC for follow-up #4
CREATE OR REPLACE FUNCTION publish_vault_memories(
  p_memory_ids uuid[],
  p_workspace_id uuid,
  p_user_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
-- SECURITY DEFINER needed: merges metadata JSONB server-side in one query
-- instead of N individual updates. Scoped by workspace_id + source filter.
DECLARE
  updated_count int;
BEGIN
  UPDATE agent_memory
  SET
    metadata = metadata || jsonb_build_object(
      'published', true,
      'published_at', now()::text,
      'published_by', p_user_id::text
    ),
    updated_at = now()
  WHERE id = ANY(p_memory_ids)
    AND workspace_id = p_workspace_id
    AND source = 'vault-sync';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS publish_vault_memories;
-- DROP POLICY IF EXISTS vault_sync_sources_select_member ON vault_sync_sources;
-- DROP POLICY IF EXISTS vault_sync_sources_insert_member ON vault_sync_sources;
-- DROP POLICY IF EXISTS vault_sync_sources_update_member ON vault_sync_sources;
-- DROP POLICY IF EXISTS vault_sync_sources_delete_member ON vault_sync_sources;
-- CREATE POLICY vault_sync_sources_service_all ON vault_sync_sources FOR ALL USING (true) WITH CHECK (true);
