import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { requirePermission } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';
import type { PermissionKey } from '@repo/types';
import { orgPermissionOverrideSchema } from '@/lib/schemas/org.schema';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * GET /api/org/permissions?workspace_id=<uuid>
 *
 * Returns the full role × permission matrix for the workspace's org:
 * - System roles with their default permissions
 * - Any org-level overrides
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }

    const permResult = await requirePermission(request, workspaceId, 'settings:read');
    if (permResult instanceof NextResponse) return permResult;

    const supabase = createServiceClient();

    // Get workspace org_id
    const { data: ws } = await supabase
      .from('workspaces')
      .select('org_id')
      .eq('id', workspaceId)
      .single();

    const orgId = ws?.org_id;

    // Fetch system roles
    const { data: roles } = await supabase
      .from('roles')
      .select('id, name, slug, description')
      .eq('is_system', true)
      .order('name');

    // Fetch all permissions
    const { data: permissions } = await supabase
      .from('permissions')
      .select('id, key, description, resource, action')
      .order('key');

    // Fetch role_permissions matrix
    const roleIds = (roles ?? []).map((r) => r.id);
    const { data: rolePerms } = await supabase
      .from('role_permissions')
      .select('role_id, permission_id')
      .in('role_id', roleIds);

    // Fetch org overrides (if org exists)
    let overrides: { role: string; permission_key: string; enabled: boolean }[] = [];
    if (orgId) {
      const { data: ovr } = await supabase
        .from('org_permission_overrides')
        .select('role, permission_key, enabled')
        .eq('org_id', orgId);
      overrides = ovr ?? [];
    }

    // Build permission map: { roleId: Set<permissionId> }
    const permMap = new Map<string, Set<string>>();
    for (const rp of rolePerms ?? []) {
      if (!permMap.has(rp.role_id)) permMap.set(rp.role_id, new Set());
      permMap.get(rp.role_id)!.add(rp.permission_id);
    }

    // Build override map: { `${roleSlug}:${permKey}`: enabled }
    const overrideMap = new Map<string, boolean>();
    for (const o of overrides) {
      overrideMap.set(`${o.role}:${o.permission_key}`, o.enabled);
    }

    return NextResponse.json({
      roles: roles ?? [],
      permissions: permissions ?? [],
      rolePermissions: Object.fromEntries(
        Array.from(permMap.entries()).map(([roleId, permIds]) => [roleId, Array.from(permIds)]),
      ),
      overrides: Object.fromEntries(overrideMap),
      orgId,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * PUT /api/org/permissions
 *
 * Upsert an org permission override (toggle a permission for a role).
 * Owner-only operation.
 */
type PermissionOverrideBody = z.infer<typeof orgPermissionOverrideSchema>;

export const PUT = withApiSecurity<PermissionOverrideBody>(
  async (
    _request: NextRequest,
    { permissionContext, body }: SecurityContext<PermissionOverrideBody>,
  ) => {
    const { workspace_id, role_slug, permission_key, enabled } = body as {
      workspace_id: string;
      role_slug: string;
      permission_key: PermissionKey;
      enabled: boolean;
    };

    // Verify the user has settings:manage (owners, platform owners, or admins with the permission)
    // The outer withApiSecurity already checks settings:manage, but this is a defense-in-depth guard
    const ctx = permissionContext!.resolved;
    if (!ctx.isOwner && !ctx.isPlatformOwner && !ctx.permissions.has('settings:manage')) {
      return NextResponse.json(
        { error: 'Requires settings:manage permission to modify role permissions' },
        { status: 403 },
      );
    }

    const supabase = createServiceClient();

    // Get org_id from workspace
    const { data: ws } = await supabase
      .from('workspaces')
      .select('org_id')
      .eq('id', workspace_id)
      .single();

    if (!ws?.org_id) {
      return NextResponse.json({ error: 'Workspace has no organization' }, { status: 400 });
    }

    // Upsert the override
    const { error } = await supabase.from('org_permission_overrides').upsert(
      {
        org_id: ws.org_id,
        role: role_slug,
        permission_key,
        enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,role,permission_key' },
    );

    if (error) throw error;

    return NextResponse.json({ ok: true });
  },
  {
    permission: 'settings:manage',
    rateLimit: { tier: RATE_WRITE, routeKey: 'org.permissions.put' },
    parseBody: orgPermissionOverrideSchema,
  },
);
