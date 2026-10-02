import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getProjects, getProjectTaskCounts } from '@repo/db/queries';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { coreErrorResponse, getCoreServices, workspaceScope } from '@/lib/core';
import { createProjectSchema } from '@/lib/schemas/projects.schema';
import { extractWorkspaceScope, requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'projects', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Workspace scope is required for project list queries
    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    // Verify membership for each workspace in the scope
    const wsIds = 'workspace_ids' in wsScope ? wsScope.workspace_ids! : [wsScope.workspace_id!];
    for (const wsId of wsIds) {
      const membershipError = await requireWorkspaceMembership(userId, wsId);
      if (membershipError) return membershipError;
    }

    const supabase = await createClient();
    const includeCounts = request.nextUrl.searchParams.get('include_counts') === 'true';

    if (includeCounts) {
      const [projects, taskCounts] = await Promise.all([
        getProjects(supabase, wsScope),
        getProjectTaskCounts(supabase, wsScope),
      ]);
      return cachedJson({ projects, taskCounts }, 10);
    }

    const projects = await getProjects(supabase, wsScope);
    return cachedJson(projects, 10);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

type CreateProjectBody = z.infer<typeof createProjectSchema>;

export const POST = withApiSecurity<CreateProjectBody>(
  async (request: NextRequest, { userId, body }: SecurityContext<CreateProjectBody>) => {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    // Prevent cross-workspace writes: body workspace_id must match the authorized query param
    if (workspaceId && body.workspace_id && body.workspace_id !== workspaceId) {
      return NextResponse.json(
        { error: 'workspace_id in body must match query parameter' },
        { status: 403 },
      );
    }

    const supabase = await createClient();
    const { workspace_id: bodyWorkspaceId, ...input } = body;
    const resolvedWorkspaceId = bodyWorkspaceId ?? workspaceId;
    if (!resolvedWorkspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const scope = workspaceScope({ workspaceId: resolvedWorkspaceId, actorId: userId });

    // Suspension and plan gates, name dedupe, and the activity row live in the service
    try {
      const project = await getCoreServices(supabase).projects.create(scope, input, {
        source: 'web',
        userId,
      });
      return NextResponse.json(project, { status: 201 });
    } catch (error) {
      const mapped = coreErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
  { permission: 'projects:create', parseBody: createProjectSchema },
);
