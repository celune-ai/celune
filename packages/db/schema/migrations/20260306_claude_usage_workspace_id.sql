-- Add workspace_id to claude_usage for workspace-scoped cost analytics
-- Part of: Workspace Analytics Isolation project

-- 1. Add the column
ALTER TABLE claude_usage ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);

-- 2. Index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_claude_usage_workspace_id ON claude_usage(workspace_id);

-- 3. Backfill from tasks table (claude_usage.task_id → tasks.workspace_id)
UPDATE claude_usage cu
SET workspace_id = t.workspace_id
FROM tasks t
WHERE cu.task_id = t.id
  AND cu.workspace_id IS NULL
  AND t.workspace_id IS NOT NULL;

-- 4. RLS note: existing policy (claude_usage_select_user) uses auth.uid() = user_id OR is_owner().
-- Workspace filtering is applied at the API query level via .eq('workspace_id') / .in('workspace_id').
-- No additional RLS policy needed — the existing user-scoped policy is sufficient.
