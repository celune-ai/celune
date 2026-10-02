import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePlatformOwner } from '@/lib/permissions';
import { waitlistSignupSchema, waitlistUpdateSchema } from '@/lib/schemas/waitlist.schema';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';
import { APP_NAME, DOMAIN_MARKETING, SUPPORT_EMAIL } from '@/lib/branding';

export const dynamic = 'force-dynamic';

/**
 * GET /api/waitlist?status=pending&limit=50&offset=0
 * List waitlist entries. Requires settings:manage permission.
 */
export async function GET(request: NextRequest) {
  try {
    const permResult = await requirePlatformOwner(request);
    if (permResult instanceof NextResponse) return permResult;

    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status');
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
    const offset = Number(searchParams.get('offset') ?? 0);
    const search = searchParams.get('search')?.trim();

    // Service client: admin waitlist read. Accesses: waitlist.
    const supabase = createServiceClient();
    let query = supabase
      .from('waitlist')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }
    if (search) {
      const escaped = search.replace(/[%_]/g, '\\$&');
      query = query.ilike('email', `%${escaped}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ data: data ?? [], total: count ?? 0 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/waitlist
 * Add email to waitlist (public-facing, also used by landing page proxy).
 */
type WaitlistSignupBody = z.infer<typeof waitlistSignupSchema>;

export const POST = withApiSecurity<WaitlistSignupBody>(
  async (_request: NextRequest, { body }: SecurityContext<WaitlistSignupBody>) => {
    const emailAddr = body.email.trim().toLowerCase();

    // Service client: waitlist insert bypasses RLS. Accesses: waitlist.
    const supabase = createServiceClient();

    // Check if this email was pre-registered as a referral (status='referred')
    const { data: existingReferred } = await supabase
      .from('waitlist')
      .select('id')
      .eq('email', emailAddr)
      .eq('status', 'referred')
      .maybeSingle();

    let referredBy: string | null = null;
    let isNew = true;

    if (existingReferred) {
      // Upgrade referred entry to pending (they actually signed up)
      await supabase
        .from('waitlist')
        .update({ status: 'pending', source: body.source || 'referral', priority: true })
        .eq('id', existingReferred.id);
      isNew = false;
    } else {
      // Resolve referrer if ref param provided
      if (body.ref) {
        const { data: referrer } = await supabase
          .from('waitlist')
          .select('id')
          .eq('email', body.ref)
          .maybeSingle();
        referredBy = referrer?.id ?? null;
      }

      // Check if email already exists (any status)
      const { data: existing } = await supabase
        .from('waitlist')
        .select('id, referral_code')
        .eq('email', emailAddr)
        .maybeSingle();

      if (existing) {
        // Await email before returning — fire-and-forget gets killed on serverless
        await sendWaitlistConfirmation(emailAddr, existing.referral_code).catch((err) => {
          console.error('[waitlist] Re-send confirmation failed:', err);
        });
        return NextResponse.json({ success: true, referral_code: existing.referral_code });
      }

      // Fresh signup
      const referralCode = crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
      const { error: insertError } = await supabase.from('waitlist').insert({
        email: emailAddr,
        source: referredBy ? 'referral' : body.source || 'landing',
        utm_source: body.utm_source || null,
        utm_medium: body.utm_medium || null,
        utm_campaign: body.utm_campaign || null,
        utm_content: body.utm_content || null,
        referrer: body.referrer || null,
        referred_by: referredBy,
        priority: !!referredBy,
        referral_code: referralCode,
      });

      if (insertError) {
        if (insertError.message?.includes('duplicate') || insertError.message?.includes('unique')) {
          return NextResponse.json({ error: "You're already on the list!" }, { status: 409 });
        }
        throw insertError;
      }
    }

    // Fetch the entry to get referral_code for the email
    const { data: entry } = await supabase
      .from('waitlist')
      .select('referral_code')
      .eq('email', emailAddr)
      .maybeSingle();

    // Await email before returning — fire-and-forget gets killed on serverless
    if (isNew) {
      await sendWaitlistConfirmation(emailAddr, entry?.referral_code).catch((err) => {
        console.error('[waitlist] Confirmation email failed:', err);
      });
    }

    return NextResponse.json({ success: true, referral_code: entry?.referral_code });
  },
  {
    requireAuth: false,
    rateLimit: { tier: RATE_WRITE, routeKey: 'waitlist.post' },
    parseBody: waitlistSignupSchema,
  },
);

/**
 * Send waitlist confirmation email via Resend.
 * Matches celune-web's sendWaitlistWelcome behavior.
 */
async function sendWaitlistConfirmation(email: string, referralCode?: string | null) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const fromEmail = process.env.RESEND_FROM_EMAIL ?? `${APP_NAME} <${SUPPORT_EMAIL}>`;
  const marketingDomain = DOMAIN_MARKETING;

  const referralSection = referralCode
    ? `
      <div style="margin: 24px 0 0; padding: 20px; border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 12px; background: rgba(34, 197, 94, 0.05); text-align: center;">
        <p style="font-size: 13px; color: #a3a3a3; margin: 0 0 12px;">Know someone who'd love Celune?</p>
        <a href="https://${marketingDomain}/?refer=${referralCode}#signup" style="display: inline-block; background: rgba(34, 197, 94, 0.15); color: #22c55e; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; text-decoration: none; border: 1px solid rgba(34, 197, 94, 0.3);">
          Refer a Friend
        </a>
        <p style="font-size: 11px; color: #525252; margin: 8px 0 0;">Refer 2 friends to unlock early access.</p>
      </div>
    `
    : '';

  const html = `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px; background: #060a07; color: #e5e5e5;">
      <div style="display:inline-block;background-color:#060a07;border-radius:8px;padding:8px 12px;margin-bottom:32px;">
        <img src="https://${marketingDomain}/celune-light.png" alt="Celune" width="110" style="display:block;" />
      </div>
      <h1 style="font-size: 28px; font-weight: 600; color: #ffffff; margin: 0 0 8px;">You're on the list!</h1>
      <p style="font-size: 16px; line-height: 1.65; color: #a3a3a3; margin: 0 0 32px;">
        Thanks for signing up for early access to Celune. We're onboarding users in small batches to ensure a great experience.
      </p>
      <p style="font-size: 16px; line-height: 1.6; color: #a3a3a3; margin: 0 0 24px;">
        We'll reach out with your personal access code once we open the next round.
      </p>
      ${referralSection}
      <p style="font-size: 14px; color: #525252; margin: 32px 0 0;">— Eric & the Celune Team</p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: email,
      subject: "You're on the Celune waitlist!",
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    throw new Error(`Resend API error ${res.status}: ${text}`);
  }
}

/**
 * PATCH /api/waitlist
 * Update waitlist entry status. Requires settings:manage permission.
 * Body: { id: string, status: string, notes?: string }
 */
type WaitlistUpdateBody = z.infer<typeof waitlistUpdateSchema>;

export const PATCH = withApiSecurity<WaitlistUpdateBody>(
  async (_request: NextRequest, { body }: SecurityContext<WaitlistUpdateBody>) => {
    const { id, status, notes } = body;

    // Service client: admin waitlist update. Accesses: waitlist.
    const supabase = createServiceClient();

    const update: Record<string, unknown> = { status };
    if (notes !== undefined) update.notes = notes;

    const { error } = await supabase.from('waitlist').update(update).eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  },
  {
    platformOwner: true,
    rateLimit: { tier: RATE_WRITE, routeKey: 'waitlist.patch' },
    parseBody: waitlistUpdateSchema,
  },
);
