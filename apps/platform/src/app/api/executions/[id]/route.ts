import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';
import { cancelServerRun, toExecutionView } from '@/lib/execution/queue-manager';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
import { getCoreServices, workspaceScope } from '@/lib/core';

export const dynamic = 'force-dynamic';

/**
 * GET /api/executions/[id]
 *
 * Get a server run including its step logs.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'executions.id.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid execution ID' }, { status: 400 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const permResult = await requirePermission(request, workspaceId, 'tasks:read');
    if (permResult instanceof NextResponse) return permResult;

    const jobs = getCoreServices(createServiceClient()).jobs;
    const scope = workspaceScope({ workspaceId, actorId: permResult.userId });
    const row = await jobs.get(scope, id);

    if (!row || row.runner !== 'server') {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    const logs = await jobs.listLogs(scope, id, { limit: 100 });

    return NextResponse.json({ execution: toExecutionView(row), logs });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * DELETE /api/executions/[id]
 *
 * Cancel a server run.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'executions.id.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid execution ID' }, { status: 400 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const permResult = await requirePermission(request, workspaceId, 'tasks:update');
    if (permResult instanceof NextResponse) return permResult;

    const services = getCoreServices(createServiceClient());
    const scope = workspaceScope({ workspaceId, actorId: permResult.userId });
    const row = await services.jobs.get(scope, id, 'id, runner, status');
    if (!row || row.runner !== 'server') {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    const job = await cancelServerRun(scope, id, services);
    if (!job) {
      return NextResponse.json(
        { error: `Cannot cancel execution in '${row.status}' status` },
        { status: 409 },
      );
    }
    return NextResponse.json({ cancelled: true, execution: job });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
