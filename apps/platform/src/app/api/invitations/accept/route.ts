import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { z } from 'zod';
import { validateOrigin } from '@/lib/csrf';

import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { syncSeats } from '@/lib/billing-seats';
export const dynamic = 'force-dynamic';

const acceptSchema = z.object({
  token: z.string().uuid('Invalid invitation token'),
});

/**
 * POST /api/invitations/accept
 * Accept a workspace invitation by token.
 * Creates workspace membership and org membership if needed.
 * Requires the user to be authenticated.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'invitations.accept.post', RATE_AUTH);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = acceptSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { token } = parsed.data;
    const supabase = createServiceClient();

    // Look up the invitation
    const { data: invitation, error: invError } = await supabase
      .from('workspace_invitations')
      .select('id, workspace_id, email, role, status, expires_at')
      .eq('token', token)
      .single();

    if (invError || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    // Check status
    if (invitation.status !== 'pending') {
      return NextResponse.json(
        { error: `This invitation has already been ${invitation.status}` },
        { status: 410 },
      );
    }

    // Check expiry
    if (new Date(invitation.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from('workspace_invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);
      return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 });
    }

    // Verify the authenticated user's email matches the invitation
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const userEmail = userData?.user?.email?.toLowerCase();
    if (!userEmail || userEmail !== invitation.email.toLowerCase()) {
      return NextResponse.json(
        {
          error:
            'This invitation was sent to a different email address. Please sign in with the correct account.',
        },
        { status: 403 },
      );
    }

    // Get workspace details to find org_id
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, org_id, name')
      .eq('id', invitation.workspace_id)
      .single();

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace no longer exists' }, { status: 404 });
    }

    // Check if user is already a member of this workspace
    const { data: existingMembership } = await supabase
      .from('workspace_memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('workspace_id', workspace.id)
      .maybeSingle();

    if (existingMembership) {
      // Already a member — mark invitation as accepted and return success
      await supabase
        .from('workspace_invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id);
      return NextResponse.json({
        success: true,
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        already_member: true,
      });
    }

    // Ensure user has org membership (needed for workspace access)
    const { data: orgMembership } = await supabase
      .from('org_memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('org_id', workspace.org_id)
      .maybeSingle();

    if (!orgMembership) {
      // Create org membership with 'member' role
      await supabase.from('org_memberships').insert({
        user_id: userId,
        org_id: workspace.org_id,
        role: 'member',
        is_owner: false,
      });
    }

    // org_members is the canonical membership (RBAC v2, Cloud seats). Keep an existing row,
    // so an invite never changes a current member's org role or reactivates them.
    const { data: memberRole } = await supabase
      .from('roles')
      .select('id')
      .eq('slug', invitation.role)
      .eq('is_system', true)
      .maybeSingle();
    if (memberRole?.id) {
      const { error: memberError } = await supabase.from('org_members').upsert(
        {
          user_id: userId,
          org_id: workspace.org_id,
          role_id: memberRole.id,
          is_owner: false,
          is_active: true,
        },
        { onConflict: 'user_id,org_id', ignoreDuplicates: true },
      );
      if (memberError) throw memberError;
    }

    // Ensure user has a user_roles entry
    const { data: userRole } = await supabase
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!userRole) {
      await supabase.from('user_roles').insert({
        user_id: userId,
        role: invitation.role,
        is_active: true,
      });
    }

    // Create workspace membership
    await supabase.from('workspace_memberships').insert({
      user_id: userId,
      workspace_id: workspace.id,
      role: invitation.role,
    });

    // Mark invitation as accepted
    await supabase
      .from('workspace_invitations')
      .update({ status: 'accepted' })
      .eq('id', invitation.id);

    await syncSeats(workspace.org_id);

    return NextResponse.json({
      success: true,
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      role: invitation.role,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
