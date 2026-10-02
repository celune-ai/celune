import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications/history
 *
 * Returns paginated notification activity log for the workspace.
 *
 * Query params:
 *   workspace_id (required)
 *   channel       (optional filter: slack | email | ...)
 *   event_type    (optional filter: task.completed | ...)
 *   from          (optional ISO date — start of range)
 *   to            (optional ISO date — end of range)
 *   page          (default 1)
 *   per_page      (default 50, max 200)
 */
export async function GET(request: NextRequest) {
  try {
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const permResult = await requirePermission(request, workspaceId, 'analytics:read');
    if (permResult instanceof NextResponse) return permResult;

    const { searchParams } = request.nextUrl;
    const channel = searchParams.get('channel');
    const eventType = searchParams.get('event_type');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(searchParams.get('per_page') ?? '50', 10)));
    const offset = (page - 1) * perPage;

    // Service client: reads notification activity log. Accesses: activity_log.
    const supabase = createServiceClient();
    let query = supabase
      .from('activity_log')
      .select('id, event_type, source, title, details, created_at', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .or('event_type.eq.notification.sent,event_type.eq.notification.failed')
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    if (channel) {
      query = query.contains('details', { channel });
    }
    if (eventType) {
      query = query.contains('details', { notification_event_type: eventType });
    }
    if (from) {
      query = query.gte('created_at', from);
    }
    if (to) {
      query = query.lte('created_at', to);
    }

    const { data, error, count } = await query;

    if (error) {
      return safeErrorResponse(error);
    }

    return NextResponse.json({
      history: data ?? [],
      total: count ?? 0,
      page,
      per_page: perPage,
      pages: Math.ceil((count ?? 0) / perPage),
    });
  } catch (err) {
    return safeErrorResponse(err);
  }
}
