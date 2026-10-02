-- Migration 027_reconstructed_hosted_columns: columns that exist in the hosted
-- project but were added by hand, outside any migration file.
--
-- Reconstructed from the hosted schema (pg_catalog read on 2026-09-26).
-- 028-fix-null-workspace-rls.sql reads agent_configs.workspace_id and
-- agent_status.workspace_id, and 20260308_agent_config_workspace_scope.sql only
-- adds them conditionally, so this file has to sort between 027 and 028.
-- Every statement is idempotent; on the hosted project it is a no-op.

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE agent_status
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;

-- claude_usage: the 20260306 org_id backfill and the daily view read these before
-- 20260306_claude_usage_workspace_id.sql and 20260319_claude_usage_rls_tighten.sql add them.
ALTER TABLE claude_usage
  ADD COLUMN IF NOT EXISTS user_id      uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);

-- project_groups: workspace scope (20260309_workspace_rls_policies.sql reads it before
-- 20260311_project_groups_workspace_id.sql adds it) plus branch and PR tracking used by
-- the GitHub webhook.
ALTER TABLE project_groups
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS branch      text,
  ADD COLUMN IF NOT EXISTS pr_url      text,
  ADD COLUMN IF NOT EXISTS pr_number   integer,
  ADD COLUMN IF NOT EXISTS base_branch text DEFAULT 'main';
