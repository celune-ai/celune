import type { ResolvedPermissions } from '@repo/types';

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer' | 'platform_owner';

/**
 * Numeric hierarchy for role comparison.
 * Higher number = more privileges.
 * Platform Owner (100) > Owner (75) > Admin (50) > Member (25) > Viewer (10).
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  platform_owner: 100,
  owner: 75,
  admin: 50,
  member: 25,
  viewer: 10,
};

/**
 * Legacy permission matrix — kept for backward compatibility.
 * New code should use resolvePermissions() from lib/permissions.ts instead.
 */
export const PERMISSIONS = {
  'tasks:create': ['owner', 'admin', 'member'],
  'tasks:read': ['owner', 'admin', 'member', 'viewer'],
  'tasks:update': ['owner', 'admin', 'member'],
  'tasks:delete': ['owner', 'admin'],
  'projects:create': ['owner', 'admin'],
  'projects:read': ['owner', 'admin', 'member', 'viewer'],
  'projects:update': ['owner', 'admin'],
  'projects:delete': ['owner', 'admin'],
  'users:manage': ['owner'], // owner-only: manages all users including admins
  'users:invite': ['owner', 'admin'],
  'settings:manage': ['owner', 'admin'],
  'agents:configure': ['owner', 'admin'],
  'billing:manage': ['owner'],
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Returns true if the given role has the specified permission.
 * @deprecated Use resolvePermissions() + hasPermission() from lib/permissions.ts
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  // Platform owner has all permissions
  if (role === 'platform_owner') return true;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

/**
 * Returns true if actorRole can manage (assign/remove) targetRole.
 * Actors can only manage roles strictly below their own level.
 * @deprecated Use canManageRoleV2() with ResolvedPermissions
 */
export function canManageRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}

/**
 * Permission-based role management check.
 * Uses resolved permissions to determine if the actor can manage the target role.
 *
 * Rules:
 * - Platform admins and org owners can manage all non-owner roles
 * - Users with 'users:manage' permission can manage roles below their level
 * - No one can manage the 'owner' role via this function
 */
export function canManageRoleV2(
  actor: ResolvedPermissions & { roleSlug?: string | null },
  targetRoleSlug: string,
): boolean {
  // Owner and platform_owner roles cannot be assigned/removed via role management.
  // Owner is transferred via dedicated flow; platform_owner is DB-only.
  if (targetRoleSlug === 'owner' || targetRoleSlug === 'platform_owner') return false;

  // Platform admins and org owners can manage all other roles
  if (actor.isOwner || actor.isPlatformOwner) return true;

  // Must have users:manage to manage roles at all
  if (!actor.permissions.has('users:manage')) return false;

  // Compare hierarchy levels — actor can only manage roles below their own
  // Org-scoped checks carry only the slug.
  const actorSlug = (actor.role?.slug ?? actor.roleSlug ?? undefined) as UserRole | undefined;
  const actorLevel = actorSlug ? (ROLE_HIERARCHY[actorSlug] ?? 0) : 0;
  const targetLevel = ROLE_HIERARCHY[targetRoleSlug as UserRole] ?? 0;

  return actorLevel > targetLevel;
}
