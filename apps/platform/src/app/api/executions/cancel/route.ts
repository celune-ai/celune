import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';
import { cancelServerRun } from '@/lib/execution/queue-manager';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { getCoreServices, workspaceScope } from '@/lib/core';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const cancelSchema = z.object({
  task_id: z.string().uuid().optional(),
  execution_id: z.string().uuid().optional(),
});

/**
 * POST /api/executions/cancel
 *
 * Cancel an active server run by task_id or execution_id.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'executions.cancel.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const workspaceId = request.nextUrl.searchParams.get('workspace_id') ?? null;
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const permResult = await requirePermission(request, workspaceId, 'tasks:update');
    if (permResult instanceof NextResponse) return permResult;

    const parsed = await parseBody(request, cancelSchema);
    if (isErrorResponse(parsed)) return parsed;

    const { task_id, execution_id } = parsed;

    if (!task_id && !execution_id) {
      return NextResponse.json({ error: 'Provide task_id or execution_id' }, { status: 400 });
    }

    const services = getCoreServices(createServiceClient());
    const scope = workspaceScope({ workspaceId, actorId: permResult.userId });

    if (execution_id) {
      const job = await cancelServerRun(scope, execution_id, services);
      if (!job) {
        return NextResponse.json({ cancelled: false, message: 'No active execution found' });
      }
      return NextResponse.json({ cancelled: true, execution_id: job.id });
    }

    const active = await services.jobs.findActive(scope, {
      runner: 'server',
      targetType: 'task',
      targetId: task_id!,
    });

    if (!active) {
      return NextResponse.json({ cancelled: false, message: 'No active execution found' });
    }

    const job = await cancelServerRun(scope, active.id, services);
    return NextResponse.json({ cancelled: job !== null, execution_id: active.id });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
