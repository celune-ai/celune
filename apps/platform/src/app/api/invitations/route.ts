import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { resolveOrgPermissions, resolvePermissions } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/invitations
 * Lists pending invitations (users who have been invited but have not confirmed).
 * Requires users:invite in an org; lists only invitations into those orgs.
 */
export async function GET(request: NextRequest) {
  try {
    const callerId = getAuthUserId(request);
    if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Service client: uses admin auth API to list all users and filter for pending invitations. Accesses: auth.users (admin API).
    const supabase = createServiceClient();

    // The platform owner sees every pending invitation; anyone else sees only
    // invitations into orgs where they hold users:invite.
    let visible: Set<string> | null = null;
    const platform = await resolvePermissions(supabase, callerId, '');
    if (!platform.isPlatformOwner) {
      const { data: callerOrgs, error: callerError } = await supabase
        .from('org_members')
        .select('org_id')
        .eq('user_id', callerId)
        .eq('is_active', true);
      if (callerError) throw callerError;
      const inviteOrgs: string[] = [];
      for (const { org_id: orgId } of callerOrgs ?? []) {
        const resolved = await resolveOrgPermissions(supabase, callerId, orgId);
        if (resolved.permissions.has('users:invite')) inviteOrgs.push(orgId);
      }
      if (inviteOrgs.length === 0) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const { data: members, error: membersError } = await supabase
        .from('org_members')
        .select('user_id')
        .in('org_id', inviteOrgs)
        .eq('is_owner', false);
      if (membersError) throw membersError;
      visible = new Set((members ?? []).map((m) => m.user_id as string));
    }

    // Fetch all users from Supabase Auth admin API with pagination to avoid the 50-user default cap
    // Collect pages until a batch comes back smaller than perPage (no more data)
    const perPage = 1000;
    let page = 1;
    let allUsers: {
      id: string;
      email?: string;
      invited_at?: string;
      confirmed_at?: string;
      created_at: string;
      user_metadata: Record<string, unknown>;
    }[] = [];

    while (true) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const batch = data?.users ?? [];
      allUsers = allUsers.concat(batch);
      // Stop when we receive fewer users than the page size — no more pages remain
      if (batch.length < perPage) break;
      page++;
    }

    // Filter for pending invitations: invited but not yet confirmed
    const pendingInvitations = allUsers
      .filter((user) => user.invited_at && !user.confirmed_at)
      .filter((user) => visible === null || visible.has(user.id))
      .map((user) => ({
        id: user.id,
        email: user.email,
        invited_at: user.invited_at,
        role: user.user_metadata?.invited_role ?? 'member',
        created_at: user.created_at,
      }));

    return NextResponse.json({ invitations: pendingInvitations });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
