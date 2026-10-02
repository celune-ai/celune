import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { createActivity } from '@repo/db/queries';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

const transferSchema = z
  .object({
    target_user_id: z.string().uuid(),
    /** Required when the caller owns more than one org that the target belongs to. */
    org_id: z.string().uuid().optional(),
  })
  .strip();

/**
 * POST /api/org/transfer-ownership
 *
 * Transfer org ownership to another user. Requirements:
 * - Caller must be the current org owner (is_owner = true).
 * - Target must be an existing org admin (has org_members row with a role).
 * - Atomic: old owner becomes admin, new owner gets is_owner = true.
 */
type TransferBody = z.infer<typeof transferSchema>;

export const POST = withApiSecurity<TransferBody>(
  async (_request: NextRequest, { userId: callerId, body }: SecurityContext<TransferBody>) => {
    const { target_user_id: targetUserId } = body;

    if (!isValidUuid(targetUserId)) {
      return NextResponse.json({ error: 'Invalid target user ID' }, { status: 400 });
    }

    // Prevent self-transfer
    if (targetUserId === callerId) {
      return NextResponse.json(
        { error: 'You cannot transfer ownership to yourself' },
        { status: 400 },
      );
    }

    // Service client: ownership transfer mutates org_members and user_roles for both caller and target. Accesses: org_members, user_roles, activity_log.
    const supabase = createServiceClient();

    // The org is one the caller actively owns and the target belongs to.
    const { data: ownedRows, error: ownedError } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', callerId)
      .eq('is_owner', true)
      .eq('is_active', true);
    if (ownedError) throw ownedError;
    const owned = (ownedRows ?? []).map((r) => r.org_id as string);
    if (owned.length === 0) {
      return NextResponse.json({ error: 'You are not an organization owner' }, { status: 403 });
    }
    if (body.org_id && !owned.includes(body.org_id)) {
      return NextResponse.json(
        { error: 'Only the organization owner can transfer ownership' },
        { status: 403 },
      );
    }
    const { data: shared, error: sharedError } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', targetUserId)
      .in('org_id', body.org_id ? [body.org_id] : owned);
    if (sharedError) throw sharedError;
    if (!shared || shared.length === 0) {
      return NextResponse.json(
        { error: 'Target user is not a member of this organization' },
        { status: 404 },
      );
    }
    if (shared.length > 1) {
      return NextResponse.json(
        { error: 'org_id is required: you own more than one org this user belongs to' },
        { status: 400 },
      );
    }
    const orgId = shared[0]!.org_id as string;

    // Verify target is an existing org member
    const { data: targetMember } = await supabase
      .from('org_members')
      .select('id, is_owner, is_active')
      .eq('user_id', targetUserId)
      .eq('org_id', orgId)
      .single();

    if (!targetMember) {
      return NextResponse.json(
        { error: 'Target user is not a member of this organization' },
        { status: 404 },
      );
    }

    if (!targetMember.is_active) {
      return NextResponse.json({ error: 'Target user is deactivated' }, { status: 400 });
    }

    if (targetMember.is_owner) {
      return NextResponse.json({ error: 'Target user is already an owner' }, { status: 400 });
    }

    // Atomic transfer via RPC — single transaction: revoke from caller + grant to target + sync user_roles
    const { error: rpcError } = await supabase.rpc('transfer_org_ownership', {
      p_from_user: callerId,
      p_to_user: targetUserId,
      p_org_id: orgId,
    });

    if (rpcError) {
      throw new Error(`Ownership transfer failed: ${rpcError.message}`);
    }

    await createActivity(supabase, {
      event_type: 'org.ownership_transferred',
      severity: 'warning',
      source: 'web',
      title: 'Organization ownership transferred',
      actor_user_id: callerId,
      details: {
        previous_owner: callerId,
        new_owner: targetUserId,
        org_id: orgId,
      },
    });

    return NextResponse.json({
      message: 'Ownership transferred successfully',
      previous_owner: callerId,
      new_owner: targetUserId,
    });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'org.transfer-ownership.post' },
    parseBody: transferSchema,
  },
);
