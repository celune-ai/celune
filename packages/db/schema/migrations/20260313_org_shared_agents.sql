-- Cross-Workspace Brain Sharing: org_shared_agents table
-- Stores agent configs shared at the org level. When sharing is enabled,
-- all workspaces in the org inherit these agents as read-only.

-- Ensure updated_at trigger function exists in public schema
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Create the org_shared_agents table
CREATE TABLE IF NOT EXISTS org_shared_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  display_name text NOT NULL,
  role text,
  description text,
  agent_type text NOT NULL DEFAULT 'ai' CHECK (agent_type IN ('ai', 'human')),
  model text,
  color text,
  persona_prompt text,
  capabilities text[] DEFAULT '{}',
  parameters jsonb DEFAULT '{}',
  config jsonb DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, agent_id)
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_org_shared_agents_org_id ON org_shared_agents(org_id);

-- 3. Updated_at trigger
CREATE OR REPLACE TRIGGER org_shared_agents_updated_at
  BEFORE UPDATE ON org_shared_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 4. RLS
ALTER TABLE org_shared_agents ENABLE ROW LEVEL SECURITY;

-- Org owners/admins can manage shared agents
CREATE POLICY "org_staff_manage_shared_agents"
  ON org_shared_agents
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      JOIN roles r ON r.id = om.role_id
      WHERE om.org_id = org_shared_agents.org_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
        AND r.slug IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM org_members om
      JOIN roles r ON r.id = om.role_id
      WHERE om.org_id = org_shared_agents.org_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
        AND r.slug IN ('owner', 'admin')
    )
  );

-- Workspace members in the org can read shared agents
CREATE POLICY "org_members_read_shared_agents"
  ON org_shared_agents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = org_shared_agents.org_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
  );

-- 5. Convention: organizations.metadata->>'sharing_enabled' controls the feature flag
COMMENT ON TABLE org_shared_agents IS
  'Agent configurations shared across all workspaces in an org. '
  'Requires organizations.metadata->>sharing_enabled = true to take effect. '
  'Shared agents appear as read-only in child workspaces.';
