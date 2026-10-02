import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';
import { runServerJob } from '@/lib/execution/agent-worker';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max for execution

/**
 * POST /api/executions/[id]/run
 *
 * Run the agent worker for one pending server run. The worker claims the
 * job through JobService, so a job another worker already claimed returns 409.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'executions.id.run.post', RATE_WRITE);
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

    const result = await runServerJob({ jobId: id, workspaceId });

    if (!result.success && result.steps === 0 && result.tokensUsed === 0) {
      if (result.error === 'Execution not found') {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      if (result.error === 'Job already claimed or not found') {
        return NextResponse.json({ error: 'Execution is not pending' }, { status: 409 });
      }
    }

    return NextResponse.json({
      execution_id: id,
      success: result.success,
      outcome: result.outcome,
      error: result.error,
      tokens_used: result.tokensUsed,
      steps: result.steps,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
