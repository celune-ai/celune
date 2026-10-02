import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { requirePermission } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace-members?workspace_id=xxx
 *
 * Lists all members of a workspace with their roles.
 * Includes org-level admins who have implicit access.
 */
export async function GET(request: NextRequest) {
  try {
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const permResult = await requirePermission(request, workspaceId, 'users:read');
    if (permResult instanceof NextResponse) return permResult;

    const supabase = createServiceClient();

    // Fetch workspace members with their role info
    const { data: members, error: membersError } = await supabase
      .from('workspace_memberships')
      .select('id, user_id, role_id, resource_ids, created_at')
      .eq('workspace_id', workspaceId);

    if (membersError) throw membersError;

    // Fetch workspace to get org_id for org-level members
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('org_id')
      .eq('id', workspaceId)
      .single();

    // Fetch org members (they have implicit workspace access)
    let orgMembers: { user_id: string; is_owner: boolean; role_id: string | null }[] = [];
    if (workspace?.org_id) {
      const { data: om } = await supabase
        .from('org_members')
        .select('user_id, is_owner, role_id')
        .eq('org_id', workspace.org_id)
        .eq('is_active', true);
      orgMembers = om ?? [];
    }

    // Collect all role_ids to fetch role details in one query
    const roleIds = new Set<string>();
    for (const m of members ?? []) {
      if (m.role_id) roleIds.add(m.role_id);
    }
    for (const m of orgMembers) {
      if (m.role_id) roleIds.add(m.role_id);
    }

    let roleMap = new Map<string, { name: string; slug: string }>();
    if (roleIds.size > 0) {
      const { data: roles } = await supabase
        .from('roles')
        .select('id, name, slug')
        .in('id', Array.from(roleIds));
      for (const r of roles ?? []) {
        roleMap.set(r.id, { name: r.name, slug: r.slug });
      }
    }

    // Collect all user_ids for auth info
    const allUserIds = new Set<string>();
    for (const m of members ?? []) allUserIds.add(m.user_id);
    for (const m of orgMembers) allUserIds.add(m.user_id);

    // Fetch user info from auth
    const {
      data: { users },
    } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const userMap = new Map<
      string,
      { email: string | null; display_name: string | null; avatar_url: string | null }
    >();
    for (const u of users ?? []) {
      if (allUserIds.has(u.id)) {
        userMap.set(u.id, {
          email: u.email ?? null,
          display_name: (u.user_metadata?.display_name as string) ?? null,
          avatar_url: (u.user_metadata?.avatar_url as string) ?? null,
        });
      }
    }

    // Build workspace member entries
    const wsMemberSet = new Set((members ?? []).map((m) => m.user_id));
    const result = [];

    // Add workspace-level members
    for (const m of members ?? []) {
      const user = userMap.get(m.user_id);
      const role = m.role_id ? roleMap.get(m.role_id) : null;
      const orgMember = orgMembers.find((om) => om.user_id === m.user_id);

      result.push({
        id: m.id,
        user_id: m.user_id,
        email: user?.email ?? null,
        display_name: user?.display_name ?? null,
        avatar_url: user?.avatar_url ?? null,
        role_id: m.role_id,
        role_name: role?.name ?? null,
        role_slug: role?.slug ?? null,
        resource_ids: m.resource_ids,
        is_org_admin: orgMember?.is_owner ?? false,
        scope: 'workspace' as const,
        created_at: m.created_at,
      });
    }

    // Add org-level members who don't have a workspace membership
    for (const om of orgMembers) {
      if (wsMemberSet.has(om.user_id)) continue;
      const user = userMap.get(om.user_id);
      const role = om.role_id ? roleMap.get(om.role_id) : null;

      result.push({
        id: null,
        user_id: om.user_id,
        email: user?.email ?? null,
        display_name: user?.display_name ?? null,
        avatar_url: user?.avatar_url ?? null,
        role_id: om.role_id,
        role_name: om.is_owner ? 'Owner' : (role?.name ?? 'Org Member'),
        role_slug: om.is_owner ? 'owner' : (role?.slug ?? null),
        resource_ids: null,
        is_org_admin: om.is_owner,
        scope: 'org' as const,
        created_at: null,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
