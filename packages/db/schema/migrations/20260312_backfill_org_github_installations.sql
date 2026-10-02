-- Migration: Backfill org_github_installations from existing workspace data
-- This is a SQL-only backfill since we can populate the table with known data.
-- GitHub account metadata (login, avatar, type) will be populated by a one-time
-- script or manually, since we need GitHub API calls for that.

-- Step 1: Insert distinct (org_id, installation_id) pairs from workspaces
-- For account metadata, use placeholder values that the sync script will update.
DO $backfill$
BEGIN
  -- 20260312_org_github_installations.sql sorts after this file; on a fresh database there is nothing to backfill.
  IF to_regclass('public.org_github_installations') IS NULL THEN
    RAISE NOTICE 'org_github_installations missing; backfill skipped';
    RETURN;
  END IF;
  EXECUTE $sql$
INSERT INTO org_github_installations (
  org_id,
  installation_id,
  github_account_login,
  github_account_type,
  connected_at,
  is_active
)
SELECT DISTINCT
  w.org_id,
  w.github_installation_id,
  'pending-sync',  -- will be updated by sync script
  'Organization',  -- default assumption, sync script corrects
  COALESCE(w.repo_connected_at, now()),
  true
FROM workspaces w
WHERE w.github_installation_id IS NOT NULL
  AND w.org_id IS NOT NULL
ON CONFLICT (installation_id) DO NOTHING;
  $sql$;
END
$backfill$;

-- Step 2: Fix known contamination — celune-app workspace had smejkaldesign's installation.
-- This was already fixed directly in Supabase (installation 114980453 → CeluneAI),
-- but we document it here for the migration audit trail.
-- No-op if already correct.
