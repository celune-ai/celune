import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidUuid } from '@repo/db/validation';
import { createActivity } from '@repo/db/queries';
import { canManageRoleV2, type UserRole } from '@/lib/roles';
import { validateOrigin } from '@/lib/csrf';
import { safeErrorResponse } from '@/lib/api-error';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { requireUserScope } from '@/lib/user-management-scope';
export const dynamic = 'force-dynamic';

const roleUpdateSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

const ASSIGNABLE_ROLES: UserRole[] = ['admin', 'member', 'viewer'];

/**
 * PUT /api/users/[id]/role
 *
 * Update a user's role. An org admin changes it only in the orgs they share with
 * the user; the platform owner changes it everywhere. Enforces hierarchy:
 * - Only owner can promote to admin
 * - Admins can only manage member/viewer
 * - Cannot change the owner's role
 * - Cannot change your own role
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'users.id.role.put', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const { id: targetUserId } = await params;

    if (!isValidUuid(targetUserId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const scope = await requireUserScope(request, targetUserId, 'users:manage');
    if (scope instanceof NextResponse) return scope;
    const { callerId, supabase } = scope;

    // Prevent self-role-change
    if (targetUserId === callerId) {
      return NextResponse.json({ error: 'You cannot change your own role' }, { status: 400 });
    }

    // Parse and validate request body with Zod
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = roleUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: owner, admin, member, viewer` },
        { status: 400 },
      );
    }

    const { role: newRole } = parsed.data;

    if (!ASSIGNABLE_ROLES.includes(newRole as UserRole)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(', ')}` },
        { status: 400 },
      );
    }

    const { data: roleRow, error: roleError } = await supabase
      .from('roles')
      .select('id')
      .eq('slug', newRole)
      .eq('is_system', true)
      .is('org_id', null)
      .limit(1)
      .single();
    if (roleError || !roleRow) throw roleError ?? new Error(`Role ${newRole} not found`);

    let previousRole: string | null;
    if (scope.platformOwner) {
      // The platform owner changes the legacy role and every non-owner org membership.
      const { data: targetData, error: targetError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', targetUserId)
        .single();
      if (targetError || !targetData) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      if (targetData.role === 'owner') {
        return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 403 });
      }
      previousRole = targetData.role;
      const { error: updateError } = await supabase
        .from('user_roles')
        .update({ role: newRole })
        .eq('user_id', targetUserId);
      if (updateError) throw updateError;
      const { error: memberError } = await supabase
        .from('org_members')
        .update({ role_id: roleRow.id })
        .eq('user_id', targetUserId)
        .eq('is_owner', false);
      if (memberError) throw memberError;
    } else {
      // An org admin changes the user's role only in the orgs they manage.
      for (const org of scope.orgs) {
        if (org.targetIsOwner) {
          return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 403 });
        }
        if (!canManageRoleV2(org.resolved, org.targetRole ?? '')) {
          return NextResponse.json(
            { error: 'Insufficient permissions to manage this user' },
            { status: 403 },
          );
        }
        if (!canManageRoleV2(org.resolved, newRole)) {
          return NextResponse.json(
            { error: 'Insufficient permissions to assign this role' },
            { status: 403 },
          );
        }
      }
      previousRole = scope.orgs[0]?.targetRole ?? null;
      const { error: memberError } = await supabase
        .from('org_members')
        .update({ role_id: roleRow.id })
        .eq('user_id', targetUserId)
        .in(
          'org_id',
          scope.orgs.map((org) => org.orgId),
        );
      if (memberError) throw memberError;
    }

    await createActivity(supabase, {
      event_type: 'user.role_changed',
      severity: 'info',
      source: 'web',
      title: `User role changed from ${previousRole} to ${newRole}`,
      actor_user_id: callerId,
      details: {
        target_user_id: targetUserId,
        previous_role: previousRole,
        new_role: newRole,
      },
    });

    return NextResponse.json({
      user_id: targetUserId,
      role: newRole as UserRole,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
