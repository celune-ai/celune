-- RBAC v2: Core permission tables
-- Creates permissions, roles, and role_permissions with seed data for system roles.

-- ============================================
-- 1. PERMISSIONS TABLE
-- ============================================
-- Each row is a unique permission key (e.g., 'tasks:create', 'billing:manage').
-- resource:action naming convention.

CREATE TABLE permissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text        NOT NULL UNIQUE,
  description text,
  resource    text        NOT NULL,  -- e.g., 'tasks', 'projects', 'billing'
  action      text        NOT NULL,  -- e.g., 'create', 'read', 'update', 'delete', 'manage'
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

-- Everyone can read permissions (they're system metadata, not sensitive)
CREATE POLICY "permissions_select" ON permissions
  FOR SELECT USING (true);

-- Only service role can modify
CREATE POLICY "permissions_service_insert" ON permissions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "permissions_service_update" ON permissions
  FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "permissions_service_delete" ON permissions
  FOR DELETE USING (auth.role() = 'service_role');


-- ============================================
-- 2. ROLES TABLE
-- ============================================
-- System roles (is_system = true) can't be deleted or renamed.
-- Custom roles (is_system = false) are created by org admins.

CREATE TABLE roles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        NOT NULL,
  description text,
  org_id      uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  is_system   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, org_id)  -- unique slug per org (NULL org_id = system role)
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Everyone can read roles
CREATE POLICY "roles_select" ON roles
  FOR SELECT USING (true);

-- Only service role can manage system roles; org admins manage custom roles
CREATE POLICY "roles_service_insert" ON roles
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "roles_service_update" ON roles
  FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "roles_service_delete" ON roles
  FOR DELETE USING (auth.role() = 'service_role');


-- ============================================
-- 3. ROLE_PERMISSIONS TABLE (join table)
-- ============================================

CREATE TABLE role_permissions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       uuid        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid        NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Everyone can read role_permissions (to resolve their own permissions)
CREATE POLICY "role_permissions_select" ON role_permissions
  FOR SELECT USING (true);

CREATE POLICY "role_permissions_service_insert" ON role_permissions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "role_permissions_service_delete" ON role_permissions
  FOR DELETE USING (auth.role() = 'service_role');


-- ============================================
-- 4. SEED: Permission keys
-- ============================================
-- Matches current PERMISSIONS map in roles.ts + new keys for RBAC v2 scope.

INSERT INTO permissions (key, resource, action, description) VALUES
  -- Tasks
  ('tasks:create',  'tasks',    'create',  'Create tasks'),
  ('tasks:read',    'tasks',    'read',    'View tasks'),
  ('tasks:update',  'tasks',    'update',  'Edit tasks'),
  ('tasks:delete',  'tasks',    'delete',  'Delete tasks'),
  -- Projects
  ('projects:create', 'projects', 'create', 'Create projects'),
  ('projects:read',   'projects', 'read',   'View projects'),
  ('projects:update', 'projects', 'update', 'Edit projects'),
  ('projects:delete', 'projects', 'delete', 'Delete projects'),
  -- Users
  ('users:manage',  'users',    'manage',  'Full user management (owner-only)'),
  ('users:invite',  'users',    'invite',  'Invite users to org/workspace'),
  ('users:read',    'users',    'read',    'View user profiles and roles'),
  -- Settings
  ('settings:manage', 'settings', 'manage', 'Manage workspace and org settings'),
  ('settings:read',   'settings', 'read',   'View settings'),
  -- Agents
  ('agents:configure', 'agents', 'configure', 'Configure AI agents'),
  ('agents:read',      'agents', 'read',      'View agent configurations'),
  -- Billing
  ('billing:manage', 'billing', 'manage', 'Manage billing, subscriptions, invoices'),
  ('billing:read',   'billing', 'read',   'View billing info'),
  -- Analytics
  ('analytics:read', 'analytics', 'read', 'View analytics dashboards'),
  -- Webhooks
  ('webhooks:manage', 'webhooks', 'manage', 'Create/edit/delete webhooks'),
  ('webhooks:read',   'webhooks', 'read',   'View webhook configurations'),
  -- API Keys
  ('api_keys:manage', 'api_keys', 'manage', 'Create/edit/revoke API keys'),
  ('api_keys:read',   'api_keys', 'read',   'View API key list'),
  -- Audit Log
  ('audit_log:read', 'audit_log', 'read', 'View audit log');


-- ============================================
-- 5. SEED: System roles
-- ============================================

INSERT INTO roles (name, slug, description, org_id, is_system) VALUES
  ('Admin',   'admin',   'Full access to all workspace resources',          NULL, true),
  ('Member',  'member',  'Can create and edit tasks/projects, limited admin', NULL, true),
  ('Viewer',  'viewer',  'Read-only access to tasks and projects',           NULL, true),
  ('Guest',   'guest',   'Scoped access to specific resources only',         NULL, true);

-- Note: No 'Owner' role. Ownership is an attribute (is_owner on org_members),
-- not a role. Owners get the Admin role + is_owner privileges.


-- ============================================
-- 6. SEED: Role → Permission mappings
-- ============================================

-- Admin: everything except billing:manage and users:manage (those are owner-only via is_owner)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'admin'
  AND p.key NOT IN ('billing:manage', 'users:manage');

-- Member: task/project CRUD + read access to agents, analytics, settings
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'member'
  AND p.key IN (
    'tasks:create', 'tasks:read', 'tasks:update',
    'projects:create', 'projects:read', 'projects:update',
    'users:read', 'settings:read', 'agents:read',
    'analytics:read', 'webhooks:read', 'api_keys:read', 'audit_log:read'
  );

-- Viewer: read-only across the board
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'viewer'
  AND p.key IN (
    'tasks:read', 'projects:read', 'users:read',
    'settings:read', 'agents:read', 'analytics:read',
    'webhooks:read', 'api_keys:read', 'audit_log:read'
  );

-- Guest: no default permissions (scoped per resource via resource_ids on workspace_memberships)
-- Admins grant specific permissions to guest roles via custom role_permissions.
