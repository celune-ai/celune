import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { requirePermission } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';
import { getOrgIdForWorkspace } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { isValidUuid } from '@repo/db/validation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get('workspace_id');

    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const permResult = await requirePermission(request, workspaceId, 'users:read');
    if (permResult instanceof NextResponse) return permResult;
    const { userId: callerId } = permResult;

    // Verify caller is a member of this workspace
    const membershipError = await requireWorkspaceMembership(callerId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();

    // Resolve workspace → org
    const orgId = await getOrgIdForWorkspace(workspaceId);
    if (!orgId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Fetch ONLY members of this org (not all users in the system)
    const { data: orgMembers, error: membersError } = await supabase
      .from('org_members')
      .select('user_id, is_owner, is_active')
      .eq('org_id', orgId);

    if (membersError) throw membersError;

    const orgUserIds = (orgMembers ?? []).map((m) => m.user_id);
    if (orgUserIds.length === 0) {
      return NextResponse.json([]);
    }

    // Build org-member maps
    const orgOwnerSet = new Set((orgMembers ?? []).filter((m) => m.is_owner).map((m) => m.user_id));
    const orgActiveMap = new Map((orgMembers ?? []).map((m) => [m.user_id, m.is_active ?? true]));

    // Fetch auth user details only for org members
    const {
      data: { users: allAuthUsers },
      error: usersError,
    } = await supabase.auth.admin.listUsers({ perPage: 1000 });

    if (usersError) throw usersError;

    // Filter to only org members
    const orgUserIdSet = new Set(orgUserIds);
    const authUsers = (allAuthUsers ?? []).filter((u) => orgUserIdSet.has(u.id));

    // Fetch role assignments scoped to this org's members
    const { data: roles } = await supabase
      .from('user_roles')
      .select('user_id, role, is_active')
      .in('user_id', orgUserIds);

    const roleMap = new Map<string, string>();
    const roleActiveMap = new Map<string, boolean>();
    for (const r of roles ?? []) {
      roleMap.set(r.user_id, r.role);
      roleActiveMap.set(r.user_id, r.is_active ?? true);
    }
    // Org owners without user_roles entries show as 'owner'
    for (const uid of orgOwnerSet) {
      if (!roleMap.has(uid)) {
        roleMap.set(uid, 'owner');
      }
    }

    // Fetch last activity scoped to this workspace
    const lastActivityMap = new Map<string, string>();
    try {
      const { data: rawActivity } = await supabase
        .from('activity_log')
        .select('user_id, created_at')
        .eq('workspace_id', workspaceId)
        .not('user_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (rawActivity) {
        for (const row of rawActivity) {
          if (row.user_id && !lastActivityMap.has(row.user_id)) {
            lastActivityMap.set(row.user_id, row.created_at);
          }
        }
      }
    } catch {
      // Non-critical
    }

    const search = searchParams.get('search')?.trim() || '';
    const roleFilter = searchParams.get('role') || '';
    const statusFilter = searchParams.get('status') || '';

    let result = authUsers.map((u) => {
      const lastSignIn = u.last_sign_in_at ?? null;
      const lastActivity = lastActivityMap.get(u.id) ?? null;
      let lastActiveAt = lastSignIn;
      if (lastActivity && (!lastActiveAt || new Date(lastActivity) > new Date(lastActiveAt))) {
        lastActiveAt = lastActivity;
      }

      const isActive =
        (orgActiveMap.get(u.id) ?? true) &&
        (roleActiveMap.get(u.id) ?? true) &&
        (!u.banned_until || new Date(u.banned_until) < new Date());

      return {
        id: u.id,
        email: u.email ?? null,
        display_name: (u.user_metadata?.display_name as string) ?? null,
        avatar_url: (u.user_metadata?.avatar_url as string) ?? null,
        role: roleMap.get(u.id) ?? 'member',
        created_at: u.created_at,
        last_sign_in_at: lastSignIn,
        last_active_at: lastActiveAt,
        is_active: isActive,
      };
    });

    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.email?.toLowerCase().includes(lower) || u.display_name?.toLowerCase().includes(lower),
      );
    }

    if (roleFilter) {
      result = result.filter((u) => u.role === roleFilter);
    }

    if (statusFilter === 'active') {
      result = result.filter((u) => u.is_active);
    } else if (statusFilter === 'deactivated') {
      result = result.filter((u) => !u.is_active);
    }

    // Sort: current user first, then by role weight, then by name
    const roleWeight: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
    result.sort((a, b) => {
      if (a.id === callerId) return -1;
      if (b.id === callerId) return 1;
      const rw = (roleWeight[a.role] ?? 9) - (roleWeight[b.role] ?? 9);
      if (rw !== 0) return rw;
      return (a.display_name ?? a.email ?? '').localeCompare(b.display_name ?? b.email ?? '');
    });

    return NextResponse.json(result);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
