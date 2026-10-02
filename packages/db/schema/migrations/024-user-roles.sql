-- 024-user-roles.sql
-- P1: Role-based authorization
-- Creates user_roles table with 4-tier role enum: owner, admin, member, viewer.
-- Owner is the top-level role with full control over all other users including admins.
-- Depends on: 023-rls-user-scoped.sql

-- ============================================================
-- Role enum
-- ============================================================
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member', 'viewer');

-- ============================================================
-- user_roles table
-- ============================================================
CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'member',
  org_id uuid,  -- nullable, reserved for future workspace/multi-tenant support
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)  -- one role per user (per org in future)
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_user_roles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_roles_updated_at
  BEFORE UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION update_user_roles_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read their own role; owners/admins can read all
CREATE POLICY "user_roles_select" ON user_roles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('owner', 'admin')
    )
  );

-- Only owners can insert new roles
CREATE POLICY "user_roles_insert" ON user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
    )
  );

-- Only owners can update roles (owner controls all admins)
CREATE POLICY "user_roles_update" ON user_roles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
    )
  );

-- Only owners can delete role assignments
CREATE POLICY "user_roles_delete" ON user_roles
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
    )
  );

-- ============================================================
-- Seed: assign owner role to the first registered user
-- ============================================================
INSERT INTO user_roles (user_id, role)
SELECT id, 'owner'
FROM auth.users
ORDER BY created_at ASC
LIMIT 1
ON CONFLICT (user_id) DO NOTHING;
