import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { requirePermission } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/roles
 *
 * Returns all system roles (owner, admin, member, viewer).
 * Includes permission IDs for each role when include_permissions=true.
 */
export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'roles', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const sp = request.nextUrl.searchParams;
    const workspaceId = sp.get('workspace_id');
    const includePermissions = sp.get('include_permissions') === 'true';

    const permResult = await requirePermission(request, workspaceId, 'users:read');
    if (permResult instanceof NextResponse) return permResult;

    const supabase = createServiceClient();

    const { data: roles, error } = await supabase
      .from('roles')
      .select('id, name, slug, description, org_id, is_system, created_at')
      .eq('is_system', true)
      .order('name');

    if (error) throw error;

    if (!includePermissions) {
      return NextResponse.json(roles ?? []);
    }

    // Fetch role_permissions for all roles
    const roleIds = (roles ?? []).map((r) => r.id);
    const { data: rolePerms } = await supabase
      .from('role_permissions')
      .select('role_id, permission_id')
      .in('role_id', roleIds);

    // Group permission IDs by role
    const permMap = new Map<string, string[]>();
    for (const rp of rolePerms ?? []) {
      const list = permMap.get(rp.role_id) ?? [];
      list.push(rp.permission_id);
      permMap.set(rp.role_id, list);
    }

    const result = (roles ?? []).map((r) => ({
      ...r,
      permission_ids: permMap.get(r.id) ?? [],
    }));

    return NextResponse.json(result);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
