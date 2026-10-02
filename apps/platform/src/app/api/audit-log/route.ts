import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audit-log
 * Enterprise audit log viewer. Admin+ only.
 * Supports filtering by workspace, actor, event_type, resource, date range.
 * Supports CSV/JSON export via Accept header or format param.
 */
export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'audit-log', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const sp = request.nextUrl.searchParams;
    const workspaceId = sp.get('workspace_id');

    const permResult = await requirePermission(request, workspaceId, 'audit_log:read');
    if (permResult instanceof NextResponse) return permResult;
    const workspaceIds = sp.get('workspace_ids')?.split(',').filter(Boolean);
    const actorUserId = sp.get('actor_user_id');
    const eventType = sp.get('event_type');
    const resourceType = sp.get('resource_type');
    const resourceId = sp.get('resource_id');
    const severity = sp.get('severity');
    const since = sp.get('since');
    const until = sp.get('until');
    const limit = Math.min(parseInt(sp.get('limit') ?? '100', 10) || 100, 1000);
    const offset = parseInt(sp.get('offset') ?? '0', 10) || 0;
    const format = sp.get('format') ?? 'json';

    // Service client: audit log reads must span all workspaces and users for admin visibility. Accesses: activity_log.
    const supabase = createServiceClient();
    let query = supabase
      .from('activity_log')
      .select(
        'id, created_at, event_type, severity, title, source, actor_user_id, agent_id, workspace_id, task_id, project_id, resource_type, resource_id, details, ip_address',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (workspaceIds && workspaceIds.length > 0) {
      query = query.in('workspace_id', workspaceIds);
    } else if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }
    if (actorUserId) query = query.eq('actor_user_id', actorUserId);
    if (eventType) query = query.eq('event_type', eventType);
    if (resourceType) query = query.eq('resource_type', resourceType);
    if (resourceId) query = query.eq('resource_id', resourceId);
    if (severity) query = query.eq('severity', severity);
    if (since) query = query.gte('created_at', since);
    if (until) query = query.lte('created_at', until);

    const { data, error, count } = await query;
    if (error) throw error;

    // CSV export
    if (format === 'csv') {
      const rows = data ?? [];
      const headers = [
        'id',
        'created_at',
        'event_type',
        'severity',
        'title',
        'source',
        'actor_user_id',
        'agent_id',
        'workspace_id',
        'resource_type',
        'resource_id',
        'ip_address',
      ];
      const csvLines = [headers.join(',')];
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        csvLines.push(
          headers
            .map((h) => {
              const v = r[h];
              if (v == null) return '';
              const s = String(v);
              return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
            })
            .join(','),
        );
      }
      return new Response(csvLines.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return NextResponse.json({ data: data ?? [], total: count ?? 0, limit, offset });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
