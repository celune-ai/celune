import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

async function requirePlatformOwner(userId: string) {
  // Service client: checks app_metadata for platform owner flag. Accesses: auth.users.
  // NEVER use user_metadata — it is user-writable and would allow privilege escalation.
  const supabase = createServiceClient();
  const { data } = await supabase.auth.admin.getUserById(userId);
  if (!data?.user?.app_metadata?.is_platform_owner) {
    return NextResponse.json({ error: 'Forbidden: platform owner only' }, { status: 403 });
  }
  return null;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'access-codes.code.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const forbidden = await requirePlatformOwner(userId);
    if (forbidden) return forbidden;

    const { code } = await params;

    // Service client: revokes an access code owned by the authenticated user. Accesses: access_codes.
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('access_codes')
      .update({ revoked_at: new Date().toISOString() })
      .eq('code', code)
      .eq('created_by', userId)
      .is('revoked_at', null)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Code not found or already revoked' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (e) {
    return safeErrorResponse(e);
  }
}
