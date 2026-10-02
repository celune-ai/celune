import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createActivity } from '@repo/db/queries';
import { safeErrorResponse } from '@/lib/api-error';
import { removeFromOrgs, requireUserScope } from '@/lib/user-management-scope';
import { validateOrigin } from '@/lib/csrf';
import { z } from 'zod';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

const uuidSchema = z.string().uuid();

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PUT /api/invitations/[id]
 * Resend an invitation to a pending user.
 * Requires owner or admin role with users:invite permission.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const rateLimitResult = await applyRateLimit(request, 'invitations.id.put', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const { id } = await context.params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid invitation ID' }, { status: 400 });
    }

    // Only an invitation into an org where the caller holds users:invite.
    const scope = await requireUserScope(request, id, 'users:invite');
    if (scope instanceof NextResponse) return scope;
    const { supabase, callerId } = scope;

    // Verify the user exists and is a pending invitation
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(id);

    if (userError || !userData?.user) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    const user = userData.user;

    if (!user.invited_at || user.confirmed_at) {
      return NextResponse.json({ error: 'This user is not a pending invitation' }, { status: 400 });
    }

    if (!user.email) {
      return NextResponse.json({ error: 'User has no email address' }, { status: 400 });
    }

    // Resend the invitation
    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(user.email, {
      data: { invited_role: user.user_metadata?.invited_role ?? 'member' },
    });

    if (inviteError) throw inviteError;

    await createActivity(supabase, {
      event_type: 'user.invitation_resent',
      severity: 'info',
      source: 'web',
      title: `Invitation resent to ${user.email}`,
      actor_user_id: callerId,
    });

    return NextResponse.json({ message: `Invitation resent to ${user.email}` });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * DELETE /api/invitations/[id]
 * Revoke a pending invitation into an org the caller manages.
 * Requires owner or admin role with users:invite permission.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const rateLimitResult = await applyRateLimit(request, 'invitations.id.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const { id } = await context.params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid invitation ID' }, { status: 400 });
    }

    // Only an invitation into an org where the caller holds users:invite.
    const scope = await requireUserScope(request, id, 'users:invite');
    if (scope instanceof NextResponse) return scope;
    const { supabase, callerId } = scope;

    // Verify the user exists and is a pending invitation
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(id);

    if (userError || !userData?.user) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    const user = userData.user;

    if (!user.invited_at || user.confirmed_at) {
      return NextResponse.json(
        { error: 'Cannot revoke: user is not a pending invitation' },
        { status: 400 },
      );
    }

    // Revoke: remove the invitee from the orgs the caller manages (every org, for
    // the platform owner). The account goes only when no other org invited it; its
    // own signup org is deleted with it when nobody else belongs to it.
    let orgIds: string[];
    if (scope.platformOwner) {
      const { data: rows, error } = await supabase
        .from('org_members')
        .select('org_id')
        .eq('user_id', id)
        .eq('is_owner', false);
      if (error) throw error;
      orgIds = (rows ?? []).map((r) => r.org_id as string);
    } else {
      orgIds = scope.orgs.map((org) => org.orgId);
    }
    if (orgIds.length > 0) await removeFromOrgs(supabase, id, orgIds);

    const { data: remaining, error: remainingError } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', id)
      .eq('is_owner', false);
    if (remainingError) throw remainingError;

    if ((remaining ?? []).length === 0) {
      const { data: owned, error: ownedError } = await supabase
        .from('organizations')
        .select('id')
        .eq('owner_id', id);
      if (ownedError) throw ownedError;
      for (const org of owned ?? []) {
        const { count, error: countError } = await supabase
          .from('org_members')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', org.id)
          .neq('user_id', id);
        if (countError) throw countError;
        if ((count ?? 0) > 0) continue;
        const { error: orgError } = await supabase.from('organizations').delete().eq('id', org.id);
        if (orgError) throw orgError;
      }
      await supabase.from('user_roles').delete().eq('user_id', id);
      const { error: deleteError } = await supabase.auth.admin.deleteUser(id);
      if (deleteError) throw deleteError;
    }

    await createActivity(supabase, {
      event_type: 'user.invitation_revoked',
      severity: 'info',
      source: 'web',
      title: `Invitation revoked for ${user.email}`,
      actor_user_id: callerId,
    });

    return NextResponse.json({ message: `Invitation for ${user.email} has been revoked` });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
