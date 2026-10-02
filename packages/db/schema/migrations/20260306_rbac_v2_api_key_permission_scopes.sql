-- RBAC v2: Add permission_scopes to api_keys
-- Evolves API key scopes from coarse ['read', 'write', 'admin'] to granular permission keys.

-- Add permission_scopes column (nullable for backward compat)
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS permission_scopes text[];

-- Backfill: map old scopes to permission keys
-- read → all :read permissions
-- write → all :read + :create + :update permissions
-- admin → all permissions
UPDATE api_keys
SET permission_scopes = CASE
  WHEN 'admin' = ANY(scopes) THEN ARRAY[
    'tasks:create', 'tasks:read', 'tasks:update', 'tasks:delete',
    'projects:create', 'projects:read', 'projects:update', 'projects:delete',
    'users:read', 'settings:read',
    'agents:configure', 'agents:read',
    'analytics:read',
    'webhooks:manage', 'webhooks:read',
    'api_keys:read',
    'audit_log:read'
  ]
  WHEN 'write' = ANY(scopes) THEN ARRAY[
    'tasks:create', 'tasks:read', 'tasks:update',
    'projects:create', 'projects:read', 'projects:update',
    'agents:read', 'analytics:read'
  ]
  ELSE ARRAY[
    'tasks:read', 'projects:read', 'agents:read', 'analytics:read'
  ]
END
WHERE permission_scopes IS NULL;
