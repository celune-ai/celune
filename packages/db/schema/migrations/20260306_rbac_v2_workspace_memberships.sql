-- RBAC v2: Extend workspace_memberships with role_id and resource_ids

ALTER TABLE workspace_memberships
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(id) ON DELETE SET NULL;

ALTER TABLE workspace_memberships
  ADD COLUMN IF NOT EXISTS resource_ids jsonb;

CREATE INDEX IF NOT EXISTS workspace_memberships_role_id_idx
  ON workspace_memberships (role_id);

-- Backfill viewers
UPDATE workspace_memberships wm
SET role_id = (SELECT id FROM roles WHERE slug = 'viewer' AND is_system = true)
WHERE EXISTS (
  SELECT 1 FROM user_roles ur
  JOIN workspaces w ON w.id = wm.workspace_id
  WHERE ur.user_id = wm.user_id AND ur.org_id = w.org_id AND ur.role = 'viewer'
);

-- Backfill remaining as Member
UPDATE workspace_memberships
SET role_id = (SELECT id FROM roles WHERE slug = 'member' AND is_system = true)
WHERE role_id IS NULL;

-- Update RLS to allow org owners/admins to read workspace memberships
DROP POLICY IF EXISTS "Users can see own workspace memberships" ON workspace_memberships;
CREATE POLICY "workspace_memberships_select" ON workspace_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN workspaces w ON w.org_id = ur.org_id
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'admin')
        AND ur.is_active = true
        AND w.id = workspace_memberships.workspace_id
    )
  );
