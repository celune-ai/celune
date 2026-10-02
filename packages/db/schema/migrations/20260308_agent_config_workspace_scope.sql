-- Workspace-scope agent configurations and status tables.
-- Adds workspace_id to agent_configs (if missing) and agent_status so each
-- workspace has its own agent roster. Nullable initially for backward compat.

-- ============================================
-- 1. agent_configs.workspace_id
-- ============================================

-- Add workspace_id column if it doesn't exist yet
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_configs' AND column_name = 'workspace_id'
  ) THEN
    ALTER TABLE agent_configs
      ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add user_id column if it doesn't exist yet (creator tracking)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_configs' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE agent_configs
      ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Change PK from agent_id alone to (workspace_id, agent_id) composite
-- This allows the same agent_id in different workspaces.
-- Only do this if the current PK is just agent_id.
DO $$ BEGIN
  -- Check if current PK is only on agent_id (single column)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'agent_configs'
      AND tc.constraint_type = 'PRIMARY KEY'
      AND kcu.column_name = 'agent_id'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.key_column_usage kcu2
        WHERE kcu2.constraint_name = tc.constraint_name
          AND kcu2.column_name = 'workspace_id'
      )
  ) THEN
    -- Drop the old single-column PK
    ALTER TABLE agent_configs DROP CONSTRAINT agent_configs_pkey;
    -- Create composite PK
    ALTER TABLE agent_configs ADD PRIMARY KEY (workspace_id, agent_id);
  END IF;
END $$;

-- ============================================
-- 2. agent_status.workspace_id
-- ============================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_status' AND column_name = 'workspace_id'
  ) THEN
    ALTER TABLE agent_status
      ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================
-- 3. Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_agent_configs_workspace
  ON agent_configs(workspace_id);

CREATE INDEX IF NOT EXISTS idx_agent_configs_workspace_active
  ON agent_configs(workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_agent_status_workspace
  ON agent_status(workspace_id);

CREATE INDEX IF NOT EXISTS idx_agent_status_workspace_agent
  ON agent_status(workspace_id, agent_name);

-- ============================================
-- 4. RLS policies for workspace scoping
-- ============================================

-- Drop old permissive policies (they allow all authenticated users to see everything)
DROP POLICY IF EXISTS "agent_configs_select" ON agent_configs;
DROP POLICY IF EXISTS "agent_configs_insert" ON agent_configs;
DROP POLICY IF EXISTS "agent_configs_update" ON agent_configs;
DROP POLICY IF EXISTS "agent_configs_delete" ON agent_configs;

DROP POLICY IF EXISTS "agent_status_select" ON agent_status;
DROP POLICY IF EXISTS "agent_status_insert" ON agent_status;
DROP POLICY IF EXISTS "agent_status_update" ON agent_status;
DROP POLICY IF EXISTS "agent_status_delete" ON agent_status;

-- agent_configs: users can read configs for workspaces they're members of
CREATE POLICY "agent_configs_select_ws" ON agent_configs
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NULL  -- legacy rows visible to all
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM org_memberships om
      JOIN workspaces w ON w.org_id = om.org_id
      WHERE om.user_id = auth.uid()
        AND om.role = 'owner'
        AND w.id = agent_configs.workspace_id
    )
  );

-- agent_configs: insert/update/delete restricted to workspace members (API routes use service role)
CREATE POLICY "agent_configs_modify_ws" ON agent_configs
  FOR ALL TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM org_memberships om
      JOIN workspaces w ON w.org_id = om.org_id
      WHERE om.user_id = auth.uid()
        AND om.role = 'owner'
        AND w.id = agent_configs.workspace_id
    )
  );

-- agent_status: same pattern
CREATE POLICY "agent_status_select_ws" ON agent_status
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM org_memberships om
      JOIN workspaces w ON w.org_id = om.org_id
      WHERE om.user_id = auth.uid()
        AND om.role = 'owner'
        AND w.id = agent_status.workspace_id
    )
  );

CREATE POLICY "agent_status_modify_ws" ON agent_status
  FOR ALL TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM org_memberships om
      JOIN workspaces w ON w.org_id = om.org_id
      WHERE om.user_id = auth.uid()
        AND om.role = 'owner'
        AND w.id = agent_status.workspace_id
    )
  );
