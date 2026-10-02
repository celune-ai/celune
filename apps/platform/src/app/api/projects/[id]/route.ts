import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getProject } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import { coreErrorResponse, getCoreServices, workspaceScope } from '@/lib/core';
import { safeErrorResponse } from '@/lib/api-error';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { updateProjectSchema } from '@/lib/schemas/projects.schema';
import { requirePermission } from '@/lib/permissions';
import { extractWorkspaceScope, requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';

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
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;
    const wsId = wsScope.workspace_id!;

    const forbidden = await requireWorkspaceMembership(userId, wsId);
    if (forbidden) return forbidden;

    const supabase = await createClient();
    const project = await getProject(supabase, id, wsId);

    return NextResponse.json(project);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const isNotFound = message.includes('PGRST116') || message.toLowerCase().includes('not found');
    if (isNotFound) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }
    return safeErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'projects.id.put', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const permResult = await requirePermission(request, workspaceId, 'projects:update');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const forbiddenPut = await requireWorkspaceMembership(permResult.userId, workspaceId);
    if (forbiddenPut) return forbiddenPut;

    const supabase = await createClient();
    const parsed = await parseBody(request, updateProjectSchema);
    if (isErrorResponse(parsed)) return parsed;

    // Workspace check, name dedupe, and the activity row live in the service
    const scope = workspaceScope({ workspaceId, actorId: permResult.userId });
    try {
      const project = await getCoreServices(supabase).projects.update(scope, id, parsed, {
        source: 'web',
        userId: permResult.userId,
      });
      return NextResponse.json(project);
    } catch (error) {
      const mapped = coreErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'projects.id.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const deleteWorkspaceId = request.nextUrl.searchParams.get('workspace_id');
  const permResult2 = await requirePermission(request, deleteWorkspaceId, 'projects:delete');
  if (permResult2 instanceof NextResponse) return permResult2;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }
    if (!deleteWorkspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const forbiddenDel = await requireWorkspaceMembership(permResult2.userId, deleteWorkspaceId);
    if (forbiddenDel) return forbiddenDel;

    const supabase = await createClient();
    const scope = workspaceScope({ workspaceId: deleteWorkspaceId, actorId: permResult2.userId });
    try {
      await getCoreServices(supabase).projects.delete(scope, id, {
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
