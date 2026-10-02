import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { parseBody } from '@/lib/parse-body';
import { createPortfolioPasswordSchema } from '@/lib/schemas/portfolio.schema';
import { createPasswordHash } from '@/lib/password-hash';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { getAuthUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET /api/portfolio/passwords?workspace_id=<uuid> — list portfolio passwords for a workspace */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;

    const membershipError = await requireWorkspaceMembership(userId, wsResult);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('portfolio_passwords')
      .select('id, project_id, workspace_id, created_at, updated_at')
      .eq('workspace_id', wsResult)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/** POST /api/portfolio/passwords?workspace_id=<uuid> — create a portfolio password */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'portfolio.passwords.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;

    const membershipError = await requireWorkspaceMembership(userId, wsResult);
    if (membershipError) return membershipError;

    const parsed = await parseBody(request, createPortfolioPasswordSchema);
    if (parsed instanceof NextResponse) return parsed;

    const passwordHash = await createPasswordHash(parsed.password);

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('portfolio_passwords')
      .insert({
        project_id: parsed.project_id,
        workspace_id: wsResult,
        password_hash: passwordHash,
      })
      .select('id, project_id, workspace_id, created_at, updated_at')
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
