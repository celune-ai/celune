-- Migration: Allow one GitHub installation to connect to multiple Celune orgs
-- Previously: UNIQUE(installation_id) enforced one-org-per-GitHub-account
-- Now: UNIQUE(org_id, installation_id) prevents duplicates within an org
--       but allows the same installation across different orgs.
-- Use case: User with access to multiple GitHub orgs (personal + work)
--           needs to connect repos from each to different Celune workspaces.

-- Drop the single-installation constraint (allows multi-org connections)
ALTER TABLE org_github_installations
  DROP CONSTRAINT IF EXISTS uq_org_github_installations_installation;

-- The composite unique (org_id, installation_id) already exists from the
-- original migration, so no need to add it. This prevents duplicate rows
-- for the same org+installation pair while allowing the same installation
-- to appear in multiple orgs.
