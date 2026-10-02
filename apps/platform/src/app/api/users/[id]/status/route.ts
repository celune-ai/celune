import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isValidUuid } from '@repo/db/validation';
import { createActivity } from '@repo/db/queries';
import { safeErrorResponse } from '@/lib/api-error';
import { canManageRoleV2 } from '@/lib/roles';
import type { UserRole } from '@/lib/roles';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { validateOrigin } from '@/lib/csrf';
import { z } from 'zod';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { requireUserScope } from '@/lib/user-management-scope';
import { orgIdsForUser, syncSeats } from '@/lib/billing-seats';
const statusSchema = z
  .object({
    is_active: z.boolean(),
  })
  .strip();

export const dynamic = 'force-dynamic';

/**
 * PUT /api/users/[id]/status
 *
 * An org admin (users:manage in an org shared with the user) sets the user's
 * org_members.is_active in those orgs only. The platform owner deactivates the
 * account: user_roles.is_active, every org membership, and the Supabase auth ban,
 * so existing sessions end at once. Prevents deactivating an owner or yourself.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'users.id.status.put', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    // 1. Validate target user ID
    const { id: targetUserId } = await params;
    if (!isValidUuid(targetUserId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    // 2. Require users:manage in an org shared with the target, or platform owner
    const scope = await requireUserScope(request, targetUserId, 'users:manage');
    if (scope instanceof NextResponse) return scope;
    const { callerId, supabase } = scope;

    // 3. Prevent self-deactivation
    if (targetUserId === callerId) {
      return NextResponse.json(
        { error: 'You cannot change your own active status' },
        { status: 400 },
      );
    }

    // 4. Validate request body
    const parsed = await parseBody(request, statusSchema);
    if (isErrorResponse(parsed)) return parsed;

    // An org admin changes the user's membership status only in the orgs they
    // manage. The account itself, its sessions, and its other orgs are untouched.
    if (!scope.platformOwner) {
      for (const org of scope.orgs) {
        if (org.targetIsOwner) {
          return NextResponse.json(
            { error: 'The organization owner cannot be deactivated' },
            { status: 403 },
          );
        }
        if (!canManageRoleV2(org.resolved, org.targetRole ?? '')) {
          return NextResponse.json(
            { error: 'You do not have permission to manage this user' },
            { status: 403 },
          );
        }
      }
      const { error: memberError } = await supabase
        .from('org_members')
        .update({ is_active: parsed.is_active })
        .eq('user_id', targetUserId)
        .in(
          'org_id',
          scope.orgs.map((org) => org.orgId),
        );
      if (memberError) throw memberError;
      await syncSeats(scope.orgs.map((org) => org.orgId));

      await createActivity(supabase, {
        event_type: parsed.is_active ? 'user.reactivated' : 'user.deactivated',
        severity: 'info',
        source: 'web',
        title: parsed.is_active ? 'User reactivated' : 'User deactivated',
        actor_user_id: callerId,
      });
      return NextResponse.json({ user_id: targetUserId, is_active: parsed.is_active });
    }

    // 5. Fetch target user's role
    const { data: targetData, error: targetError } = await supabase
      .from('user_roles')
      .select('role, is_active')
      .eq('user_id', targetUserId)
      .single();

    if (targetError || !targetData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const targetRole = targetData.role as UserRole;

    // 6. Prevent deactivating the platform owner
    if (targetRole === 'owner') {
      return NextResponse.json(
        { error: 'The owner account cannot be deactivated' },
        { status: 403 },
      );
    }

    // 7. Verify caller can manage the target's role
    if (!canManageRoleV2(scope.resolved, targetRole)) {
      return NextResponse.json(
        { error: 'You do not have permission to manage this user' },
        { status: 403 },
      );
    }

    // 8. Update is_active in user_roles
    const { data: updated, error: updateError } = await supabase
      .from('user_roles')
      .update({ is_active: parsed.is_active })
      .eq('user_id', targetUserId)
      .select('user_id, role, is_active')
      .single();

    if (updateError) {
      throw updateError;
    }

    // Dual-write: sync org_members during migration
    try {
      await supabase
        .from('org_members')
        .update({ is_active: parsed.is_active })
        .eq('user_id', targetUserId);
    } catch {
      // org_members sync is best-effort during migration
    }
    await syncSeats(await orgIdsForUser(targetUserId));

    // 9. Sync Supabase auth ban state so existing sessions are immediately affected.
    //    Deactivating: ban_duration='876000h' (~100 years = effectively permanent)
    //    Reactivating: ban_duration='none' clears the ban
    const { error: banError } = await supabase.auth.admin.updateUserById(targetUserId, {
      ban_duration: parsed.is_active ? 'none' : '876000h',
    });

    if (banError) {
      // Roll back the user_roles update to keep state consistent
      await supabase
        .from('user_roles')
        .update({ is_active: !parsed.is_active })
        .eq('user_id', targetUserId);
      throw banError;
    }

    // 10. Log the deactivation/reactivation event
    await createActivity(supabase, {
      event_type: parsed.is_active ? 'user.reactivated' : 'user.deactivated',
      severity: 'info',
      source: 'web',
      title: parsed.is_active ? 'User reactivated' : 'User deactivated',
      actor_user_id: callerId,
    });

    return NextResponse.json(updated);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
