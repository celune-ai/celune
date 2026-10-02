import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { parseBody } from '@/lib/parse-body';
import { updatePortfolioPasswordSchema } from '@/lib/schemas/portfolio.schema';
import { createPasswordHash } from '@/lib/password-hash';
import { isValidUuid } from '@repo/db/validation';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { getAuthUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** PATCH /api/portfolio/passwords/[id]?workspace_id=<uuid> — update password */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'portfolio.passwords.patch', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;

    const membershipError = await requireWorkspaceMembership(userId, wsResult);
    if (membershipError) return membershipError;

    const parsed = await parseBody(request, updatePortfolioPasswordSchema);
    if (parsed instanceof NextResponse) return parsed;

    if (!parsed.password) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const passwordHash = await createPasswordHash(parsed.password);

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('portfolio_passwords')
      .update({ password_hash: passwordHash })
      .eq('id', id)
      .eq('workspace_id', wsResult)
      .select('id, project_id, workspace_id, created_at, updated_at')
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/** DELETE /api/portfolio/passwords/[id]?workspace_id=<uuid> — delete password */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'portfolio.passwords.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;

    const membershipError = await requireWorkspaceMembership(userId, wsResult);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('portfolio_passwords')
      .delete()
      .eq('id', id)
      .eq('workspace_id', wsResult);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
