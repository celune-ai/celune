import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { createRateLimit } from '@/lib/rate-limit';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { redeemAccessCodeSchema } from '@/lib/schemas/access-codes.schema';

import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { PLAN_LABELS, normalizePlan } from '@repo/types';
// 5 attempts per user per 15 minutes
const redeemLimiter = createRateLimit({ limit: 5, windowMs: 15 * 60 * 1000 });

export async function POST(req: NextRequest) {
  const rateLimitResult = await applyRateLimit(req, 'access-codes.redeem.post', RATE_AUTH);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(req);
    if (originError) return originError;

    const userId = getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = redeemLimiter.check(userId);
    if (!rl.allowed) {
      const retryAfterSecs = Math.ceil(rl.retryAfterMs / 1000);
      return NextResponse.json(
        {
          error: 'Too many redemption attempts. Please try again later.',
          retryAfterSeconds: retryAfterSecs,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSecs),
          },
        },
      );
    }

    const parsed = await parseBody(req, redeemAccessCodeSchema);
    if (isErrorResponse(parsed)) return parsed;
    const { code } = parsed;

    // Service client: redeem access code. Accesses: access_codes.
    const supabase = createServiceClient();

    // Check code exists, not redeemed, not revoked, not expired
    const { data: existing } = await supabase
      .from('access_codes')
      .select('id, code, plan, redeemed_by, expires_at')
      .eq('code', code)
      .is('revoked_at', null)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 404 });
    }

    // Check expiration
    if (existing.expires_at && new Date(existing.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This access code has expired' }, { status: 410 });
    }

    if (existing.redeemed_by) {
      return NextResponse.json({ error: 'Code has already been redeemed' }, { status: 409 });
    }

    // Redeem the code with optimistic concurrency check
    const { data, error } = await supabase
      .from('access_codes')
      .update({
        redeemed_by: userId,
        redeemed_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .is('redeemed_by', null)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Code has already been redeemed' }, { status: 409 });
    }

    // Transition waitlist entry from 'provisioned' → 'created' if applicable
    if (data.note) {
      const emailMatch = data.note.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (emailMatch) {
        await supabase
          .from('waitlist')
          .update({ status: 'created', updated_at: new Date().toISOString() })
          .eq('email', emailMatch[0])
          .eq('status', 'provisioned');
      }
    }

    const plan = normalizePlan(data.plan) === 'enterprise' ? 'enterprise' : 'cloud';
    return NextResponse.json({
      message: `Code redeemed successfully. You now have ${PLAN_LABELS[plan]} access.`,
      plan,
    });
  } catch (e) {
    return safeErrorResponse(e);
  }
}

/**
 * DELETE /api/access-codes/redeem
 *
 * Release the user's redeemed access code. This revokes their unlimited
 * access and drops them back to whatever subscription they have (or Builder).
 */
export async function DELETE(req: NextRequest) {
  const rateLimitResult = await applyRateLimit(req, 'access-codes.redeem.delete', RATE_AUTH);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(req);
    if (originError) return originError;

    const userId = getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createServiceClient();

    // Find and revoke the user's active access code
    const { data, error } = await supabase
      .from('access_codes')
      .update({ revoked_at: new Date().toISOString() })
      .eq('redeemed_by', userId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();

    if (error) return safeErrorResponse(error);
    if (!data) {
      return NextResponse.json({ error: 'No active access code found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Access code released.' });
  } catch (e) {
    return safeErrorResponse(e);
  }
}
