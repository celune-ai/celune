import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { requirePermission } from '@/lib/permissions';
import { validateOrigin } from '@/lib/csrf';
import { safeErrorResponse } from '@/lib/api-error';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { createActivity } from '@repo/db/queries';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

const updateSchema = z
  .object({
    role_id: z.string().uuid().optional(),
    resource_ids: z.array(z.string().uuid()).optional(),
  })
  .strip();

/**
 * PATCH /api/workspace-members/[id]
 *
 * Update a workspace member's role or resource scoping.
 * Only workspace admins and org admins can change workspace roles.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'workspace-members.id.patch', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const { id: membershipId } = await params;
    if (!isValidUuid(membershipId)) {
      return NextResponse.json({ error: 'Invalid membership ID' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch the membership to get workspace_id
    const { data: membership, error: fetchError } = await supabase
      .from('workspace_memberships')
      .select('id, user_id, workspace_id, role_id')
      .eq('id', membershipId)
      .single();

    if (fetchError || !membership) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }

    const permResult = await requirePermission(request, membership.workspace_id, 'users:manage');
    if (permResult instanceof NextResponse) return permResult;
    const { userId: callerId } = permResult;

    // Prevent self-role-change
    if (membership.user_id === callerId) {
      return NextResponse.json(
        { error: 'You cannot change your own workspace role' },
        { status: 400 },
      );
    }

    const parsed = await parseBody(request, updateSchema);
    if (isErrorResponse(parsed)) return parsed;

    const updates: Record<string, unknown> = {};
    if (parsed.role_id !== undefined) updates.role_id = parsed.role_id;
    if (parsed.resource_ids !== undefined) updates.resource_ids = parsed.resource_ids;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    // Validate role_id exists
    if (parsed.role_id) {
      const { data: role } = await supabase
        .from('roles')
        .select('id, slug')
        .eq('id', parsed.role_id)
        .single();
      if (!role) {
        return NextResponse.json({ error: 'Invalid role_id' }, { status: 400 });
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('workspace_memberships')
      .update(updates)
      .eq('id', membershipId)
      .select('id, user_id, role_id, resource_ids')
      .single();

    if (updateError) throw updateError;

    await createActivity(supabase, {
      event_type: 'workspace.member_role_changed',
      severity: 'info',
      source: 'web',
      title: 'Workspace member role updated',
      actor_user_id: callerId,
      details: {
        target_user_id: membership.user_id,
        workspace_id: membership.workspace_id,
        previous_role_id: membership.role_id,
        new_role_id: parsed.role_id ?? membership.role_id,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * DELETE /api/workspace-members/[id]
 *
 * Remove a user from a workspace (does not affect org membership).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'workspace-members.id.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const { id: membershipId } = await params;
    if (!isValidUuid(membershipId)) {
      return NextResponse.json({ error: 'Invalid membership ID' }, { status: 400 });
    }
    const supabase = createServiceClient();

    // Fetch the membership
    const { data: membership, error: fetchError } = await supabase
      .from('workspace_memberships')
      .select('id, user_id, workspace_id')
      .eq('id', membershipId)
      .single();

    if (fetchError || !membership) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }

    const permResult = await requirePermission(request, membership.workspace_id, 'users:manage');
    if (permResult instanceof NextResponse) return permResult;
    const { userId: callerId } = permResult;

    // Prevent self-removal
    if (membership.user_id === callerId) {
      return NextResponse.json(
        { error: 'You cannot remove yourself from the workspace' },
        { status: 400 },
      );
    }

    const { error: deleteError } = await supabase
      .from('workspace_memberships')
      .delete()
      .eq('id', membershipId);

    if (deleteError) throw deleteError;

    await createActivity(supabase, {
      event_type: 'workspace.member_removed',
      severity: 'info',
      source: 'web',
      title: 'Member removed from workspace',
      actor_user_id: callerId,
      details: {
        target_user_id: membership.user_id,
        workspace_id: membership.workspace_id,
      },
    });

    return NextResponse.json({ message: 'Member removed' });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
