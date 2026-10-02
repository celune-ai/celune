import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { requireWorkspaceMembership } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * GET /api/memory/contradictions?workspace_id=<uuid>&limit=<n>
 * Returns pairs of contradicting memories for review.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get('workspace_id');
    const limit = Math.min(Math.max(1, Number(searchParams.get('limit') ?? 20)), 50);

    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const membershipError = await requireWorkspaceMembership(user.id, workspaceId);
    if (membershipError) return membershipError;

    const { data, error } = await supabase.rpc('find_contradictions', {
      p_workspace_id: workspaceId,
      p_limit: limit,
    });

    if (error) throw error;

    return NextResponse.json({ contradictions: data ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
