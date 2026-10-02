-- Permissions Sprint 1, Task 1: Add granular permission keys + org_permission_overrides
-- Adds 15 new permission keys, seeds role_permissions for 5-tier role matrix,
-- and creates org_permission_overrides table for per-org customization.

-- ============================================
-- 1. INSERT new permission keys
-- ============================================
-- The permissions table uses plain text keys (not an enum), so we just INSERT.

INSERT INTO permissions (key, resource, action, description) VALUES
  -- Tasks (new)
  ('tasks:assign',         'tasks',         'assign',   'Assign/reassign tasks to users'),
  -- Agents (new)
  ('agents:chat',          'agents',        'chat',     'Chat with AI agents'),
  ('agents:delete',        'agents',        'delete',   'Delete agent configurations'),
  -- Memory
  ('memory:read',          'memory',        'read',     'View agent memory entries'),
  ('memory:write',         'memory',        'write',    'Create and update memory entries'),
  ('memory:delete',        'memory',        'delete',   'Delete memory entries'),
  -- Analytics (new)
  ('analytics:export',     'analytics',     'export',   'Export analytics data'),
  -- Users (new)
  ('users:deactivate',     'users',         'deactivate', 'Deactivate user accounts'),
  -- Integrations
  ('integrations:read',    'integrations',  'read',     'View integration configurations'),
  ('integrations:manage',  'integrations',  'manage',   'Create/edit/delete integrations'),
  -- Notifications
  ('notifications:read',   'notifications', 'read',     'View notifications'),
  ('notifications:manage', 'notifications', 'manage',   'Manage notification preferences and channels'),
  -- Workspace (new)
  ('workspace:delete',     'workspace',     'delete',   'Delete a workspace'),
  ('workspace:transfer',   'workspace',     'transfer', 'Transfer workspace ownership'),
  -- Voice
  ('voice:use',            'voice',         'use',      'Use voice/TTS features')
ON CONFLICT (key) DO NOTHING;


-- ============================================
-- 2. Add Owner and Platform Owner system roles
-- ============================================
-- The core migration only created admin/member/viewer/guest.
-- We need owner and platform_owner for the 5-tier matrix.

INSERT INTO roles (name, slug, description, org_id, is_system) VALUES
  ('Owner',          'owner',          'Full org access including billing and user management', NULL, true),
  ('Platform Owner', 'platform_owner', 'Platform-wide superadmin with all permissions',         NULL, true)
ON CONFLICT (slug, org_id) DO NOTHING;


-- ============================================
-- 3. Re-seed role_permissions for all 5 tiers
-- ============================================
-- Clear existing system role permissions and re-seed with the full matrix.
-- Only affects system roles (org_id IS NULL, is_system = true).

DELETE FROM role_permissions
WHERE role_id IN (
  SELECT id FROM roles WHERE is_system = true AND org_id IS NULL
);

-- Platform Owner: ALL permissions (37 keys)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'platform_owner' AND r.is_system = true AND r.org_id IS NULL;

-- Owner: all except workspace:transfer (36 keys)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'owner' AND r.is_system = true AND r.org_id IS NULL
  AND p.key != 'workspace:transfer';

-- Admin: 29 keys — no billing:manage, workspace:delete/transfer, users:deactivate, users:manage
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'admin' AND r.is_system = true AND r.org_id IS NULL
  AND p.key NOT IN (
    'billing:manage',
    'workspace:delete',
    'workspace:transfer',
    'users:deactivate',
    'users:manage'
  );

-- Member: 19 keys — CRUD tasks/projects, read access, agents:chat, voice:use, notifications
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'member' AND r.is_system = true AND r.org_id IS NULL
  AND p.key IN (
    'tasks:create', 'tasks:read', 'tasks:update', 'tasks:assign',
    'projects:create', 'projects:read', 'projects:update',
    'users:read',
    'settings:read',
    'agents:read', 'agents:chat',
    'analytics:read',
    'memory:read',
    'integrations:read',
    'notifications:read', 'notifications:manage',
    'webhooks:read', 'api_keys:read',
    'voice:use'
  );

-- Viewer: 11 keys — read-only, no voice
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'viewer' AND r.is_system = true AND r.org_id IS NULL
  AND p.key IN (
    'tasks:read',
    'projects:read',
    'users:read',
    'settings:read',
    'agents:read',
    'analytics:read',
    'memory:read',
    'integrations:read',
    'notifications:read',
    'webhooks:read',
    'api_keys:read'
  );

-- Guest: no default permissions (unchanged)


-- ============================================
-- 4. org_permission_overrides table
-- ============================================
-- Allows per-org customization of role permissions.
-- e.g., disable voice:use for members in a specific org.

CREATE TABLE IF NOT EXISTS org_permission_overrides (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role           text        NOT NULL,
  permission_key text        NOT NULL,
  enabled        boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, role, permission_key)
);

ALTER TABLE org_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Read: org members can see overrides for their org
CREATE POLICY "org_permission_overrides_select" ON org_permission_overrides
  FOR SELECT USING (true);

-- Write: service role only
CREATE POLICY "org_permission_overrides_service_insert" ON org_permission_overrides
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "org_permission_overrides_service_update" ON org_permission_overrides
  FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "org_permission_overrides_service_delete" ON org_permission_overrides
  FOR DELETE USING (auth.role() = 'service_role');

-- Index for fast lookups
CREATE INDEX idx_org_permission_overrides_org_role
  ON org_permission_overrides (org_id, role);

-- From 20260310_cr_fixes_rpc_scoping_rls.sql (sorts before this file): scope SELECT to org members.
DROP POLICY IF EXISTS "org_permission_overrides_select" ON org_permission_overrides;

CREATE POLICY "org_permission_overrides_select" ON org_permission_overrides
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = org_permission_overrides.org_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_valid_role') THEN
    ALTER TABLE org_permission_overrides
      ADD CONSTRAINT chk_valid_role
      CHECK (role IN ('viewer', 'member', 'admin', 'owner', 'platform_owner'));
  END IF;
END $$;
