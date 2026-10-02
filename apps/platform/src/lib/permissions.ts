/**
 * RBAC v2 — Permission Resolution
 *
 * Replaces role-name checks with granular permission-key checks.
 * All route handlers use requirePermission() from this module.
 *
 * Resolution order:
 *   1. Platform owner (user_roles.role = 'owner') → ALL permissions
 *   2. No workspace → no permissions (use resolveOrgPermissions for org-level checks)
 *   3. Org owner (org_members.is_owner = true) → ALL permissions
 *   4. Org-level role (org_members.role_id) → role_permissions keys
 *   5. Workspace-level role (workspace_memberships.role_id) → role_permissions keys
 *   6. Default deny → empty set
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { isValidUuid } from '@repo/db/validation';
import { logPermissionDenied, logAuthFailure } from '@/lib/security-audit';
import type { PermissionKey, ResolvedPermissions } from '@repo/types';
import { PERMISSION_CATEGORIES } from '@repo/types';

/** Derived from the canonical PERMISSION_CATEGORIES map — always in sync. */
const ALL_PERMISSION_KEYS: PermissionKey[] = Object.keys(PERMISSION_CATEGORIES) as PermissionKey[];

const ALL_PERMISSIONS = new Set<PermissionKey>(ALL_PERMISSION_KEYS);
const EMPTY_PERMISSIONS = new Set<PermissionKey>();

/**
 * Resolves effective permissions for a user in a workspace.
 * Uses a single RPC call (resolve_user_permissions) instead of multiple queries.
 * Uses service client (bypasses RLS) — only call from trusted server-side code.
 */
export async function resolvePermissions(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  workspaceId: string,
): Promise<ResolvedPermissions> {
  try {
    const { data, error } = await supabase.rpc('resolve_user_permissions', {
      p_user_id: userId,
      p_workspace_id: workspaceId || null,
    });

    if (error || !data) {
      return {
        role: null,
        permissions: new Set(EMPTY_PERMISSIONS),
        isOwner: false,
        isPlatformOwner: false,
      };
    }

    const result = data as {
      is_platform_owner: boolean;
      is_owner: boolean;
      is_active: boolean;
      role_slug: string | null;
      permission_keys: string[];
    };

    // Deactivated user
    if (!result.is_active) {
      return {
        role: null,
        permissions: new Set(EMPTY_PERMISSIONS),
        isOwner: false,
        isPlatformOwner: false,
      };
    }

    const permissions = new Set<PermissionKey>((result.permission_keys ?? []) as PermissionKey[]);

    return {
      role: null,
      permissions,
      isOwner: result.is_owner,
      isPlatformOwner: result.is_platform_owner,
    };
  } catch {
    // RPC not available — fall back to multi-query resolution
    return resolvePermissionsFallback(supabase, userId, workspaceId);
  }
}

/**
 * Fallback: multi-query permission resolution.
 * Used if the RPC function is not yet deployed.
 */
async function resolvePermissionsFallback(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  workspaceId: string,
): Promise<ResolvedPermissions> {
  // Step 1: Check user_roles for platform owner / deactivation
  try {
    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role, is_active')
      .eq('user_id', userId)
      .single();

    if (userRole?.is_active === false) {
      return {
        role: null,
        permissions: new Set(EMPTY_PERMISSIONS),
        isOwner: false,
        isPlatformOwner: false,
      };
    }

    if (userRole?.role === 'owner') {
      return {
        role: null,
        permissions: new Set(ALL_PERMISSIONS),
        isOwner: true,
        isPlatformOwner: true,
      };
    }
  } catch {
    // user_roles table may not exist — ignore
  }

  // Step 2: Resolve workspace → org_id
  let orgId: string | null = null;
  try {
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('org_id')
      .eq('id', workspaceId)
      .single();
    orgId = workspace?.org_id ?? null;
  } catch {
    // workspaces unavailable
  }

  // Step 3: Org membership
  if (orgId) {
    try {
      const { data: orgMember } = await supabase
        .from('org_members')
        .select('role_id, is_owner, is_active')
        .eq('user_id', userId)
        .eq('org_id', orgId)
        .single();

      if (orgMember) {
        if (orgMember.is_active === false) {
          return {
            role: null,
            permissions: new Set(EMPTY_PERMISSIONS),
            isOwner: false,
            isPlatformOwner: false,
          };
        }
        if (orgMember.is_owner) {
          return {
            role: null,
            permissions: new Set(ALL_PERMISSIONS),
            isOwner: true,
            isPlatformOwner: false,
          };
        }
        if (orgMember.role_id) {
          const permissions = await fetchRolePermissions(supabase, orgMember.role_id);
          if (permissions.size > 0) {
            return { role: null, permissions, isOwner: false, isPlatformOwner: false };
          }
        }
      }
    } catch {
      // org_members may not exist
    }
  }

  // Step 4: Workspace membership
  try {
    const { data: wsMember } = await supabase
      .from('workspace_memberships')
      .select('role_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .single();

    if (wsMember?.role_id) {
      const permissions = await fetchRolePermissions(supabase, wsMember.role_id);
      return { role: null, permissions, isOwner: false, isPlatformOwner: false };
    }
  } catch {
    // workspace_memberships may not exist
  }

  // Step 5: Default deny
  return {
    role: null,
    permissions: new Set(EMPTY_PERMISSIONS),
    isOwner: false,
    isPlatformOwner: false,
  };
}

async function fetchRolePermissions(
  supabase: ReturnType<typeof createServiceClient>,
  roleId: string,
): Promise<Set<PermissionKey>> {
  try {
    const { data } = await supabase
      .from('role_permissions')
      .select('permissions(key)')
      .eq('role_id', roleId);

    if (!data) return new Set();

    const keys = data
      .map((row: { permissions: { key: string }[] | { key: string } | null }) => {
        const p = row.permissions;
        if (Array.isArray(p)) return p[0]?.key;
        return p?.key;
      })
      .filter((key): key is PermissionKey => key != null);

    return new Set(keys);
  } catch {
    return new Set();
  }
}

/** Returns true if the resolved permission set includes the given key. */
export function hasPermission(resolved: ResolvedPermissions, key: PermissionKey): boolean {
  return resolved.permissions.has(key);
}

export type PermissionContext = {
  userId: string;
  resolved: ResolvedPermissions;
};

/**
 * Server-side permission guard for API route handlers.
 *
 * Usage:
 *   const result = await requirePermission(request, workspaceId, 'tasks:create');
 *   if (result instanceof NextResponse) return result;
 *   const { userId, resolved } = result;
 */
export async function requirePermission(
  request: NextRequest,
  workspaceId: string | null,
  ...requiredKeys: PermissionKey[]
): Promise<PermissionContext | NextResponse> {
  const userId = getAuthUserId(request);
  if (!userId) {
    logAuthFailure('no_auth_user_id', { url: request.nextUrl.pathname });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate workspace_id format before any DB queries
  if (workspaceId && !isValidUuid(workspaceId)) {
    return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
  }

  // Service client: resolves RBAC permissions across org/workspace boundaries for authorization. Accesses: org_members, workspace_memberships, role_permissions.
  const supabase = createServiceClient();
  const resolved = await resolvePermissions(supabase, userId, workspaceId ?? '');

  const missing = requiredKeys.filter((key) => !resolved.permissions.has(key));
  if (missing.length > 0) {
    logPermissionDenied(userId, missing.join(','), workspaceId ?? undefined);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { userId, resolved };
}

/** Permissions of a user within one org, from resolve_user_org_permissions. Fails closed. */
export async function resolveOrgPermissions(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  orgId: string,
): Promise<ResolvedPermissions & { roleSlug: string | null }> {
  const denied = {
    role: null,
    permissions: new Set(EMPTY_PERMISSIONS),
    isOwner: false,
    isPlatformOwner: false,
    roleSlug: null,
  };
  const { data, error } = await supabase.rpc('resolve_user_org_permissions', {
    p_user_id: userId,
    p_org_id: orgId,
  });
  if (error || !data) return denied;
  const result = data as {
    is_platform_owner: boolean;
    is_owner: boolean;
    is_active: boolean;
    role_slug: string | null;
    permission_keys: string[] | null;
  };
  if (!result.is_active) return denied;
  return {
    role: null,
    permissions: new Set((result.permission_keys ?? []) as PermissionKey[]),
    isOwner: result.is_owner,
    isPlatformOwner: result.is_platform_owner,
    roleSlug: result.role_slug,
  };
}

/** Route guard for platform-wide routes: only the platform owner passes. */
export async function requirePlatformOwner(
  request: NextRequest,
): Promise<PermissionContext | NextResponse> {
  const userId = getAuthUserId(request);
  if (!userId) {
    logAuthFailure('no_auth_user_id', { url: request.nextUrl.pathname });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const resolved = await resolvePermissions(createServiceClient(), userId, '');
  if (!resolved.isPlatformOwner) {
    logPermissionDenied(userId, 'platform_owner');
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { userId, resolved };
}
