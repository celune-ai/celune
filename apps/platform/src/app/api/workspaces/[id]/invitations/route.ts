import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { z } from 'zod';
import { validateOrigin } from '@/lib/csrf';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { requireActivePlan } from '@/lib/plan-enforcement';
export const dynamic = 'force-dynamic';

const createInvitationSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .transform((s) => s.trim().toLowerCase()),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

/**
 * GET /api/workspaces/[id]/invitations
 * List pending invitations for a workspace.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: workspaceId } = await params;
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 });
    }
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createServiceClient();

    // Verify user has access to this workspace's org
    const { data: membership } = await supabase
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single();
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Verify workspace belongs to user's org
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, org_id')
      .eq('id', workspaceId)
      .eq('org_id', membership.org_id)
      .single();
    if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const { data: invitations, error } = await supabase
      .from('workspace_invitations')
      .select('id, email, role, status, invited_by, expires_at, created_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ invitations: invitations ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/workspaces/[id]/invitations
 * Create a new invitation. Requires owner/admin role.
 * Generates a crypto token with 7-day TTL.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(
    request,
    'workspaces.id.invitations.post',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id: workspaceId } = await params;
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 });
    }
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createServiceClient();

    // Parse and validate body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = createInvitationSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { email, role } = parsed.data;

    // Verify user's org membership and role
    const { data: membership } = await supabase
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single();
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Only owner/admin can invite
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only owners and admins can send invitations' },
        { status: 403 },
      );
    }

    // Verify workspace belongs to user's org
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, org_id, name')
      .eq('id', workspaceId)
      .eq('org_id', membership.org_id)
      .single();
    if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    // Paywall: an org without a plan cannot add members
    const blocked = await requireActivePlan({ workspaceId, userId });
    if (blocked) return blocked;

    // Self-invite prevention
    const { data: inviterUser } = await supabase.auth.admin.getUserById(userId);
    if (inviterUser?.user?.email?.toLowerCase() === email) {
      return NextResponse.json({ error: 'You cannot invite yourself' }, { status: 400 });
    }

    // Note: We don't check if the email is already a workspace member here.
    // The accept endpoint (/api/invitations/accept) handles this gracefully —
    // if the user is already a member, it marks the invitation as accepted
    // and returns `already_member: true`.

    // Check for existing pending invitation
    const { data: existingInvite } = await supabase
      .from('workspace_invitations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingInvite) {
      return NextResponse.json(
        { error: 'An invitation is already pending for this email' },
        { status: 409 },
      );
    }

    // Generate secure token and 7-day expiry
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const { data: invitation, error } = await supabase
      .from('workspace_invitations')
      .insert({
        workspace_id: workspaceId,
        email,
        role,
        invited_by: userId,
        token,
        expires_at: expiresAt.toISOString(),
      })
      .select('id, email, role, status, expires_at, created_at')
      .single();

    if (error) throw error;

    // Build accept URL (no email sent yet — MVP returns it in the response)
    const baseUrl = request.headers.get('origin') || request.nextUrl.origin;
    const acceptUrl = `${baseUrl}/app/invitations/accept?token=${token}`;

    return NextResponse.json(
      {
        invitation,
        accept_url: acceptUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
