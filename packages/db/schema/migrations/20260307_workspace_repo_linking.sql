-- Migration: Workspace Repository Linking (Phase 1)
-- Adds first-class repo columns to the workspaces table.
-- Replaces the informal metadata.repo_url convention with proper typed columns.
--
-- All columns are nullable to allow zero-downtime deployment and gradual
-- migration of existing workspaces. repo_provider defaults to 'github' for
-- future-proofing (GitLab, Bitbucket support is a non-goal for Phase 1).

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS repo_url               TEXT,
  ADD COLUMN IF NOT EXISTS repo_provider          TEXT NOT NULL DEFAULT 'github',
  ADD COLUMN IF NOT EXISTS repo_path              TEXT,
  ADD COLUMN IF NOT EXISTS repo_connected_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS github_installation_id BIGINT;

-- Add a check constraint to keep repo_provider values to known providers.
-- This is a soft guard; the application layer enforces stricter validation.
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_repo_provider_check
  CHECK (repo_provider IN ('github', 'gitlab', 'bitbucket'));

-- Index for looking up workspaces by GitHub installation (used during
-- GitHub App callback to associate an installation with a workspace).
CREATE INDEX IF NOT EXISTS idx_workspaces_github_installation_id
  ON public.workspaces (github_installation_id)
  WHERE github_installation_id IS NOT NULL;

-- Index for org-scoped repo URL lookups (e.g., detect duplicate connections).
CREATE INDEX IF NOT EXISTS idx_workspaces_repo_url
  ON public.workspaces (org_id, repo_url)
  WHERE repo_url IS NOT NULL;

COMMENT ON COLUMN public.workspaces.repo_url IS
  'Full GitHub repository URL, e.g. https://github.com/org/repo. Null if not yet connected.';

COMMENT ON COLUMN public.workspaces.repo_provider IS
  'VCS provider identifier. Currently only ''github'' is supported. Defaults to ''github''.';

COMMENT ON COLUMN public.workspaces.repo_path IS
  'Path within the repository root. Use ''/'' or NULL for standalone repos. Use ''apps/looq'' for monorepo sub-folders.';

COMMENT ON COLUMN public.workspaces.repo_connected_at IS
  'Timestamp when the repository connection was established. NULL means connection is pending or was deferred.';

COMMENT ON COLUMN public.workspaces.github_installation_id IS
  'GitHub App installation ID for this workspace. Required for GitHub API calls on behalf of the connected repo.';
