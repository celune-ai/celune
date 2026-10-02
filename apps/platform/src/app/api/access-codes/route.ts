import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { z } from 'zod';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const createAccessCodeSchema = z.object({
  note: z.string().max(100).optional(),
});

async function requirePlatformOwner(userId: string) {
  // Service client: checks user metadata for platform owner flag. Accesses: auth.users.
  const supabase = createServiceClient();
  const { data } = await supabase.auth.admin.getUserById(userId);
  if (!data?.user?.app_metadata?.is_platform_owner) {
    return NextResponse.json({ error: 'Forbidden: platform owner only' }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const forbidden = await requirePlatformOwner(userId);
    if (forbidden) return forbidden;

    // Service client: lists all access codes created by the authenticated owner. Accesses: access_codes.
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('access_codes')
      .select('id, code, created_by, note, redeemed_by, redeemed_at, revoked_at, created_at')
      .eq('created_by', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    return safeErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'access-codes.create', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const forbidden = await requirePlatformOwner(userId);
    if (forbidden) return forbidden;

    const rawBody = await request.json().catch(() => ({}));
    const parsed = createAccessCodeSchema.safeParse(rawBody);
    const note = parsed.success ? (parsed.data.note ?? null) : null;

    // Generate cryptographically random 12-char code
    const code = crypto.randomBytes(9).toString('base64url').slice(0, 12).toUpperCase();

    // Service client: inserts a new access code for the authenticated owner. Accesses: access_codes.
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('access_codes')
      .insert({ code, created_by: userId, note })
      .select('id, code, created_by, note, redeemed_by, redeemed_at, revoked_at, created_at')
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return safeErrorResponse(e);
  }
}
