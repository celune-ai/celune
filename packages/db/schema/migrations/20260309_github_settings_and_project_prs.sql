-- Migration: GitHub workspace settings + project_prs table
-- Covers Sprint 1 of Smart Branch & Workspace Context project

-- ============================================================
-- 1. Add github_settings jsonb column to workspaces
-- ============================================================

ALTER TABLE workspaces
ADD COLUMN IF NOT EXISTS github_settings jsonb DEFAULT '{
  "pr_strategy": "per_project",
  "auto_pr": "draft_on_push",
  "branch_naming": {
    "prefix": "celune",
    "separator": "/",
    "include_assignee": true,
    "slug_source": "project_name"
  },
  "default_reviewers": [],
  "rebase_threshold_commits": 20,
  "stale_pr_warning_days": 7,
  "agent_code_context": true,
  "auto_sync_on_push": true,
  "webhook_events": false
}'::jsonb;

-- ============================================================
-- 2. Create project_prs table
-- ============================================================

CREATE TABLE IF NOT EXISTS project_prs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- PR identity
  pr_number int NOT NULL,
  pr_url text NOT NULL,
  branch_name text NOT NULL,
  title text,

  -- Status tracking
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'merged')),
  ci_status text DEFAULT 'pending'
    CHECK (ci_status IS NULL OR ci_status IN ('pending', 'passing', 'failing')),
  review_state text DEFAULT 'pending'
    CHECK (review_state IS NULL OR review_state IN ('pending', 'approved', 'changes_requested', 'commented', 'dismissed')),

  -- File tracking for merge conflict detection
  files_changed text[] DEFAULT '{}',
  additions int DEFAULT 0,
  deletions int DEFAULT 0,

  -- Branch divergence tracking
  head_sha text,
  base_branch text DEFAULT 'main',
  commits_behind_main int DEFAULT 0,

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  merged_at timestamptz,
  closed_at timestamptz,

  -- Unique constraint: one PR number per workspace (repos have unique PR numbers)
  UNIQUE (workspace_id, pr_number)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_project_prs_project_id ON project_prs(project_id);
CREATE INDEX IF NOT EXISTS idx_project_prs_workspace_id ON project_prs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_project_prs_branch_name ON project_prs(branch_name);
CREATE INDEX IF NOT EXISTS idx_project_prs_status ON project_prs(status) WHERE status != 'merged' AND status != 'closed';

-- GIN index on files_changed for overlap queries
CREATE INDEX IF NOT EXISTS idx_project_prs_files ON project_prs USING GIN (files_changed);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_project_prs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_prs_updated_at ON project_prs;
CREATE TRIGGER trg_project_prs_updated_at
  BEFORE UPDATE ON project_prs
  FOR EACH ROW
  EXECUTE FUNCTION update_project_prs_updated_at();

-- ============================================================
-- 3. RLS policies for project_prs
-- ============================================================

ALTER TABLE project_prs ENABLE ROW LEVEL SECURITY;

-- Members of the workspace (or org owners/admins) can read PRs
CREATE POLICY "workspace_members_read_prs" ON project_prs
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_memberships
      WHERE user_id = auth.uid()
    )
    OR workspace_id IN (
      SELECT w.id FROM workspaces w
      JOIN org_memberships om ON om.org_id = w.org_id
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

-- Service role can do everything (API routes use service client)
CREATE POLICY "service_role_all_prs" ON project_prs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 4. RPC for file overlap detection
-- ============================================================

CREATE OR REPLACE FUNCTION check_file_overlap(
  p_project_id uuid,
  p_workspace_id uuid
)
RETURNS TABLE (
  conflicting_project_id uuid,
  conflicting_project_name text,
  conflicting_pr_number int,
  conflicting_branch text,
  overlapping_files text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify the calling user has access to this workspace
  IF NOT EXISTS (
    SELECT 1 FROM workspace_memberships
    WHERE user_id = auth.uid() AND workspace_id = p_workspace_id
  ) AND NOT EXISTS (
    SELECT 1 FROM workspaces w
    JOIN org_memberships om ON om.org_id = w.org_id
    WHERE w.id = p_workspace_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
  ) THEN
    RETURN; -- Return empty set for unauthorized callers
  END IF;

  RETURN QUERY
  WITH target_files AS (
    -- Get all files changed by the target project's active PRs
    SELECT UNNEST(pp.files_changed) AS file_path
    FROM project_prs pp
    WHERE pp.project_id = p_project_id
      AND pp.workspace_id = p_workspace_id
      AND pp.status IN ('draft', 'open')
  ),
  other_prs AS (
    -- Get all active PRs from OTHER projects in the same workspace
    SELECT pp.project_id, pp.pr_number, pp.branch_name, pp.files_changed
    FROM project_prs pp
    WHERE pp.workspace_id = p_workspace_id
      AND pp.project_id != p_project_id
      AND pp.status IN ('draft', 'open')
      AND array_length(pp.files_changed, 1) > 0
  )
  SELECT
    op.project_id AS conflicting_project_id,
    p.name AS conflicting_project_name,
    op.pr_number AS conflicting_pr_number,
    op.branch_name AS conflicting_branch,
    ARRAY(
      SELECT DISTINCT tf.file_path
      FROM target_files tf
      WHERE tf.file_path = ANY(op.files_changed)
    ) AS overlapping_files
  FROM other_prs op
  JOIN projects p ON p.id = op.project_id
  WHERE EXISTS (
    SELECT 1
    FROM target_files tf
    WHERE tf.file_path = ANY(op.files_changed)
  );
END;
$$;

COMMENT ON FUNCTION check_file_overlap IS
  'Detects file-level overlaps between a project''s active PRs and other active PRs in the same workspace. Used for merge conflict early warning. SECURITY DEFINER needed to bypass RLS for cross-project comparison filtered by workspace_id.';
