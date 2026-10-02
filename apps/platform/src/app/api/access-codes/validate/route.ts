import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { validateAccessCodeSchema } from '@/lib/schemas/access-codes.schema';

/**
 * POST /api/access-codes/validate
 * Public endpoint (no auth) — checks if an access code exists and is available.
 * Does NOT redeem it. Used by the gated signup flow to validate before showing the signup form.
 */
export async function POST(req: NextRequest) {
  const rateLimitResult = await applyRateLimit(req, 'access-codes.validate', RATE_AUTH);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const parsed = await parseBody(req, validateAccessCodeSchema);
    if (isErrorResponse(parsed)) return parsed;

    const code = parsed.code.trim().toUpperCase();

    if (!code || code.length < 8) {
      return NextResponse.json({ error: 'Please enter a valid access code.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: existing } = await supabase
      .from('access_codes')
      .select('id, note')
      .eq('code', code)
      .is('revoked_at', null)
      .is('redeemed_by', null)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { error: 'Invalid or already redeemed access code.' },
        { status: 404 },
      );
    }

    // Extract email from note field (format: "Waitlist invite for email@example.com")
    let email: string | undefined;
    if (existing.note) {
      const emailMatch = existing.note.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (emailMatch) email = emailMatch[0];
    }

    return NextResponse.json({ valid: true, ...(email && { email }) });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
