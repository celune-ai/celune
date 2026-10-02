import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getTask } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import { coreErrorResponse, getCoreServices, workspaceScope } from '@/lib/core';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { updateTaskSchema } from '@/lib/schemas/tasks.schema';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { extractWorkspaceScope, requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { runTaskUpdatedEffects } from '@/lib/tasks/task-effects';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    // Require workspace scope for single-item reads
    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;
    const wsId = wsScope.workspace_id!;

    const forbidden = await requireWorkspaceMembership(userId, wsId);
    if (forbidden) return forbidden;

    const supabase = await createClient();
    const task = await getTask(supabase, id, wsId);

    return NextResponse.json(task);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'tasks.id.put', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const permResult = await requirePermission(request, workspaceId, 'tasks:update');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const forbiddenPut = await requireWorkspaceMembership(permResult.userId, workspaceId);
    if (forbiddenPut) return forbiddenPut;

    const supabase = await createClient();
    const parsed = await parseBody(request, updateTaskSchema);
    if (isErrorResponse(parsed)) return parsed;

    // Transition validation, piv_stage, completion stamps, dependency checks,
    // the activity row, and the agent_status reset live in the service.
    const scope = workspaceScope({ workspaceId, actorId: permResult.userId });
    let result;
    try {
      result = await getCoreServices(supabase).tasks.update(scope, id, parsed, {
        source: 'web',
        userId: permResult.userId,
      });
    } catch (error) {
      const mapped = coreErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
    await runTaskUpdatedEffects(result, supabase, workspaceId);

    return NextResponse.json(result.task);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'tasks.id.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const deleteWorkspaceId = request.nextUrl.searchParams.get('workspace_id');
  const permResult2 = await requirePermission(request, deleteWorkspaceId, 'tasks:delete');
  if (permResult2 instanceof NextResponse) return permResult2;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    if (!deleteWorkspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const forbiddenDel = await requireWorkspaceMembership(permResult2.userId, deleteWorkspaceId);
    if (forbiddenDel) return forbiddenDel;

    const supabase = await createClient();
    const scope = workspaceScope({ workspaceId: deleteWorkspaceId, actorId: permResult2.userId });
    try {
      await getCoreServices(supabase).tasks.delete(scope, id, {
        source: 'web',
        userId: permResult2.userId,
      });
    } catch (error) {
      const mapped = coreErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
