import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { requirePlatformOwner } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/platform
 *
 * Platform owner only. Returns all users across all organizations
 * with their org name and usage analytics.
 */
export async function GET(request: NextRequest) {
  try {
    // Only the platform owner can see cross-org users
    const permResult = await requirePlatformOwner(request);
    if (permResult instanceof NextResponse) return permResult;

    const { userId } = permResult;

    const supabase = createServiceClient();

    // Get the caller's org so we can exclude it
    const { data: callerOrg } = await supabase
      .from('org_memberships')
      .select('org_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    const callerOrgId = callerOrg?.org_id;

    // Fetch all auth users
    const {
      data: { users },
      error: usersError,
    } = await supabase.auth.admin.listUsers({ perPage: 1000 });

    if (usersError) throw usersError;

    // Fetch all org memberships with org name
    const { data: memberships } = await supabase
      .from('org_memberships')
      .select('user_id, org_id, role, organizations(name)');

    // Fetch workspace counts per org
    const { data: workspaceCounts } = await supabase.from('workspaces').select('org_id');

    // Fetch task counts per org
    const { data: taskCounts } = await supabase.from('tasks').select('org_id');

    // Build lookup maps
    const orgWorkspaces = new Map<string, number>();
    for (const w of workspaceCounts ?? []) {
      orgWorkspaces.set(w.org_id, (orgWorkspaces.get(w.org_id) ?? 0) + 1);
    }

    const orgTasks = new Map<string, number>();
    for (const t of taskCounts ?? []) {
      orgTasks.set(t.org_id, (orgTasks.get(t.org_id) ?? 0) + 1);
    }

    type MembershipRow = {
      user_id: string;
      org_id: string;
      role: string;
      organizations: { name: string } | { name: string }[] | null;
    };

    const membershipMap = new Map<string, { org_id: string; org_name: string; role: string }>();
    for (const m of (memberships ?? []) as MembershipRow[]) {
      const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      membershipMap.set(m.user_id, {
        org_id: m.org_id,
        org_name: org?.name ?? 'Unknown',
        role: m.role ?? 'member',
      });
    }

    // Build result — only users NOT in the caller's org
    const result = (users ?? [])
      .filter((u) => {
        const membership = membershipMap.get(u.id);
        return membership && membership.org_id !== callerOrgId;
      })
      .map((u) => {
        const membership = membershipMap.get(u.id)!;
        return {
          id: u.id,
          email: u.email ?? null,
          display_name: (u.user_metadata?.display_name as string) ?? null,
          avatar_url: (u.user_metadata?.avatar_url as string) ?? null,
          org_name: membership.org_name,
          org_id: membership.org_id,
          role: membership.role,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          workspaces: orgWorkspaces.get(membership.org_id) ?? 0,
          tasks: orgTasks.get(membership.org_id) ?? 0,
        };
      });

    return NextResponse.json(result);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
