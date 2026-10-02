// RBAC v2 permission system types

/** A permission key like 'tasks:create', 'billing:manage' */
export type PermissionKey =
  // Tasks
  | 'tasks:create'
  | 'tasks:read'
  | 'tasks:update'
  | 'tasks:delete'
  | 'tasks:assign'
  // Projects
  | 'projects:create'
  | 'projects:read'
  | 'projects:update'
  | 'projects:delete'
  // Users
  | 'users:manage'
  | 'users:invite'
  | 'users:read'
  | 'users:deactivate'
  // Settings
  | 'settings:manage'
  | 'settings:read'
  // Agents
  | 'agents:configure'
  | 'agents:read'
  | 'agents:chat'
  | 'agents:delete'
  // Billing
  | 'billing:manage'
  | 'billing:read'
  // Analytics
  | 'analytics:read'
  | 'analytics:export'
  // Webhooks
  | 'webhooks:manage'
  | 'webhooks:read'
  // API Keys
  | 'api_keys:manage'
  | 'api_keys:read'
  // Audit Log
  | 'audit_log:read'
  // Memory
  | 'memory:read'
  | 'memory:write'
  | 'memory:delete'
  // Integrations
  | 'integrations:read'
  | 'integrations:manage'
  // Notifications
  | 'notifications:read'
  | 'notifications:manage'
  // Workspace
  | 'workspace:delete'
  | 'workspace:transfer'
  // Voice
  | 'voice:use';

/** Permission category for grouping keys in UI */
export type PermissionCategory =
  | 'tasks'
  | 'projects'
  | 'users'
  | 'settings'
  | 'agents'
  | 'billing'
  | 'analytics'
  | 'webhooks'
  | 'api_keys'
  | 'audit_log'
  | 'memory'
  | 'integrations'
  | 'notifications'
  | 'workspace'
  | 'voice';

/** Maps each permission key to its category */
export const PERMISSION_CATEGORIES: Record<PermissionKey, PermissionCategory> = {
  'tasks:create': 'tasks',
  'tasks:read': 'tasks',
  'tasks:update': 'tasks',
  'tasks:delete': 'tasks',
  'tasks:assign': 'tasks',
  'projects:create': 'projects',
  'projects:read': 'projects',
  'projects:update': 'projects',
  'projects:delete': 'projects',
  'users:manage': 'users',
  'users:invite': 'users',
  'users:read': 'users',
  'users:deactivate': 'users',
  'settings:manage': 'settings',
  'settings:read': 'settings',
  'agents:configure': 'agents',
  'agents:read': 'agents',
  'agents:chat': 'agents',
  'agents:delete': 'agents',
  'billing:manage': 'billing',
  'billing:read': 'billing',
  'analytics:read': 'analytics',
  'analytics:export': 'analytics',
  'webhooks:manage': 'webhooks',
  'webhooks:read': 'webhooks',
  'api_keys:manage': 'api_keys',
  'api_keys:read': 'api_keys',
  'audit_log:read': 'audit_log',
  'memory:read': 'memory',
  'memory:write': 'memory',
  'memory:delete': 'memory',
  'integrations:read': 'integrations',
  'integrations:manage': 'integrations',
  'notifications:read': 'notifications',
  'notifications:manage': 'notifications',
  'workspace:delete': 'workspace',
  'workspace:transfer': 'workspace',
  'voice:use': 'voice',
};

/** System role slugs in the 5-tier hierarchy */
export type RoleSlug = 'viewer' | 'member' | 'admin' | 'owner' | 'platform_owner';

/** Numeric hierarchy levels for role comparison */
export const ROLE_SLUG_HIERARCHY: Record<RoleSlug, number> = {
  viewer: 10,
  member: 25,
  admin: 50,
  owner: 75,
  platform_owner: 100,
};

/** Row from the `permissions` table */
export interface Permission {
  id: string;
  key: PermissionKey;
  description: string | null;
  resource: string;
  action: string;
  created_at: string;
}

/** Row from the `roles` table */
export interface Role {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  org_id: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

/** Row from the `role_permissions` join table */
export interface RolePermission {
  id: string;
  role_id: string;
  permission_id: string;
  created_at: string;
}

/** Row from the `org_members` table (Sprint 1, Task 2) */
export interface OrgMember {
  id: string;
  user_id: string;
  org_id: string;
  role_id: string;
  is_owner: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Row from the `org_permission_overrides` table */
export interface PermissionOverride {
  id: string;
  org_id: string;
  role: string;
  permission_key: PermissionKey;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Controls which features/sections are visible for a role */
export interface FeatureVisibilityConfig {
  role: RoleSlug;
  /** Navigation items visible to this role */
  visibleNavItems: string[];
  /** Whether the role can see admin-level settings */
  showAdminSettings: boolean;
  /** Whether the role can see billing section */
  showBilling: boolean;
}

/** Fully resolved permission matrix for a user in a specific context */
export interface ResolvedPermissionMatrix {
  /** The user's role slug */
  roleSlug: RoleSlug | null;
  /** Base permissions from role */
  basePermissions: PermissionKey[];
  /** Org-level overrides applied */
  overrides: PermissionOverride[];
  /** Final resolved set of granted permissions */
  effectivePermissions: PermissionKey[];
}

/** A named preset of permissions for quick role setup */
export interface PermissionPreset {
  name: string;
  description: string;
  permissions: PermissionKey[];
}

/** Audit entry for permission changes */
export interface PermissionChangeLog {
  id: string;
  org_id: string;
  changed_by: string;
  role: string;
  permission_key: PermissionKey;
  action: 'grant' | 'revoke';
  timestamp: string;
}

/** Result of resolvePermissions() */
export interface ResolvedPermissions {
  role: Role | null;
  permissions: Set<PermissionKey>;
  isOwner: boolean;
  isPlatformOwner: boolean;
}
