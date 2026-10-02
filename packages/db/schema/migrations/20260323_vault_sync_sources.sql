-- Vault Sync Sources — tracks Obsidian vault paths configured for sync
-- Each row = one vault folder configured via .celune-sync allowlist

CREATE TABLE IF NOT EXISTS vault_sync_sources (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vault_path  text NOT NULL,                     -- absolute path to vault root
  sync_config jsonb NOT NULL DEFAULT '{}'::jsonb, -- parsed .celune-sync allowlist + PARA mapping
  file_hashes jsonb NOT NULL DEFAULT '{}'::jsonb, -- { "relative/path.md": "sha256-hash" }
  last_synced_at timestamptz,
  files_synced   int NOT NULL DEFAULT 0,
  chunks_created int NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'syncing', 'complete', 'failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One vault path per workspace
CREATE UNIQUE INDEX IF NOT EXISTS vault_sync_sources_ws_path_idx
  ON vault_sync_sources (workspace_id, vault_path);

-- RLS
ALTER TABLE vault_sync_sources ENABLE ROW LEVEL SECURITY;

-- Service role only (cron + API routes use service client)
CREATE POLICY vault_sync_sources_service_all
  ON vault_sync_sources FOR ALL
  USING (true) WITH CHECK (true);

-- Rollback:
-- DROP TABLE IF EXISTS vault_sync_sources;

-- From 20260323_vault_sync_rls_and_followups.sql (sorts before this file): tenant-isolated policies.
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
