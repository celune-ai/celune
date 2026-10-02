import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { createServiceClient } from '@repo/db/service';
import { DOMAIN_APP } from '@/lib/branding';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/device/code
 *
 * Device Authorization Flow — Step 1 (RFC 8628-style).
 * Called by the CLI (no auth required). Generates a device_code (secret)
 * and a user_code (human-readable) that the user confirms in the browser.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'auth.device-code', RATE_AUTH);
  if (rateLimitResult) return rateLimitResult.blocked;

  // 256-bit device code (secret — CLI keeps this)
  const deviceCode = randomBytes(32).toString('hex');

  // Human-readable user code: XXXX-XXXX (uppercase alphanumeric, no ambiguous chars)
  const userCode = generateUserCode();

  const supabase = createServiceClient();

  // Clean up expired pending codes (housekeeping)
  await supabase
    .from('device_auth_codes')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString());

  // Create new device auth code (10 minute expiry)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const { error } = await supabase.from('device_auth_codes').insert({
    device_code: deviceCode,
    user_code: userCode,
    status: 'pending',
    expires_at: expiresAt,
    client_ip: clientIp,
  });

  if (error) {
    // Unique constraint collision on user_code — retry once
    if (error.code === '23505') {
      const retryCode = generateUserCode();
      const { error: retryError } = await supabase.from('device_auth_codes').insert({
        device_code: deviceCode,
        user_code: retryCode,
        status: 'pending',
        expires_at: expiresAt,
        client_ip: clientIp,
      });
      if (retryError) {
        return NextResponse.json({ error: 'Failed to create device code' }, { status: 500 });
      }
      return NextResponse.json({
        device_code: deviceCode,
        user_code: retryCode,
        verification_uri: `${getBaseUrl(request)}/device/verify`,
        expires_in: 600,
        interval: 5,
      });
    }
    return NextResponse.json({ error: 'Failed to create device code' }, { status: 500 });
  }

  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${getBaseUrl(request)}/device/verify`,
    expires_in: 600,
    interval: 5,
  });
}

// ---- Helpers ----

/** Characters that are unambiguous when read aloud or typed (no 0/O, 1/I/l) */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateUserCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function getBaseUrl(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host = request.headers.get('host') ?? DOMAIN_APP;
  return `${proto}://${host}`;
}
