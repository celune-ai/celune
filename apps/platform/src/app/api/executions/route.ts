import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import { getCoreServices, workspaceScope } from '@/lib/core';
import { toExecutionView } from '@/lib/execution/queue-manager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/executions
 *
 * List server runs for the current workspace.
 * Query params: workspace_id (required), status, task_id, limit, offset
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'executions.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }

    const permResult = await requirePermission(request, workspaceId, 'tasks:read');
    if (permResult instanceof NextResponse) return permResult;

    const status = request.nextUrl.searchParams.get('status');
    const taskId = request.nextUrl.searchParams.get('task_id');
    const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10);
    const offset = parseInt(request.nextUrl.searchParams.get('offset') ?? '0', 10);

    const jobs = getCoreServices(createServiceClient()).jobs;
    const { rows, total } = await jobs.list(
      workspaceScope({ workspaceId, actorId: permResult.userId }),
      {
        runner: 'server',
        statuses: status ? [status] : undefined,
        targetType: taskId ? 'task' : undefined,
        targetId: taskId ?? undefined,
        limit,
        offset,
      },
    );

    return NextResponse.json({ executions: rows.map(toExecutionView), total });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
