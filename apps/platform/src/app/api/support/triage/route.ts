import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/support/triage?workspace_id=...&status=...&source=...&limit=50
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const workspaceId = searchParams.get('workspace_id');

  const permResult = await requirePermission(request, workspaceId, 'settings:manage');
  if (permResult instanceof NextResponse) return permResult;

  const rateLimitResult = await applyRateLimit(request, 'support.triage.read', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const status = searchParams.get('status');
    const source = searchParams.get('source');
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
    const offset = Number(searchParams.get('offset') ?? 0);

    const supabase = createServiceClient();

    let query = supabase
      .from('conversation_logs')
      .select(
        'id, workspace_id, user_id, agent_id, source, status, subject, summary, message_count, created_at, updated_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (workspaceId) query = query.eq('workspace_id', workspaceId);
    if (status) query = query.eq('status', status);
    if (source) query = query.eq('source', source);

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ data: data ?? [], total: count ?? 0 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * GET /api/support/triage/[id]/messages
 * Fetch messages for a specific conversation
 */
