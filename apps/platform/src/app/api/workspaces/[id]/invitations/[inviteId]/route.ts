import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/workspaces/[id]/invitations/[inviteId]
 * Revoke a pending invitation. Owner/admin only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  const rateLimitResult = await applyRateLimit(
    request,
    'workspaces.id.invitations.inviteId.delete',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id: workspaceId, inviteId } = await params;
    if (!isValidUuid(workspaceId) || !isValidUuid(inviteId)) {
      return NextResponse.json({ error: 'Invalid workspace or invitation ID' }, { status: 400 });
    }
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createServiceClient();

    // Verify user's org membership and role
    const { data: membership } = await supabase
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single();
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only owners and admins can revoke invitations' },
        { status: 403 },
      );
    }

    // Verify workspace belongs to user's org
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, org_id')
      .eq('id', workspaceId)
      .eq('org_id', membership.org_id)
      .single();
    if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    // Update invitation status to revoked
    const { data: invitation, error } = await supabase
      .from('workspace_invitations')
      .update({ status: 'revoked' })
      .eq('id', inviteId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .select('id, email, status')
      .single();

    if (error || !invitation) {
      return NextResponse.json(
        { error: 'Invitation not found or already processed' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, invitation });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
