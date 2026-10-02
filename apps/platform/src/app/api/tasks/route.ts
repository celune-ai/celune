import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getTasks } from '@repo/db/queries';
import type { TaskStatus } from '@repo/types';
import { createTaskSchema } from '@/lib/schemas/tasks.schema';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { coreErrorResponse, getCoreServices, workspaceScope } from '@/lib/core';
import { runTaskCreatedEffects } from '@/lib/tasks/task-effects';
import { extractWorkspaceScope, requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { isAgentEmployed } from '@/lib/agent-employment';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Workspace scope is required for all task list queries
    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    // Verify membership for each workspace in the scope
    const wsIds = 'workspace_ids' in wsScope ? wsScope.workspace_ids! : [wsScope.workspace_id!];
    for (const wsId of wsIds) {
      const membershipError = await requireWorkspaceMembership(userId, wsId);
      if (membershipError) return membershipError;
    }

    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;
    const countOnly = searchParams.get('count_only') === 'true';
    const status = (searchParams.get('status') as TaskStatus) ?? undefined;
    const project_id = searchParams.get('project_id') ?? undefined;
    const top_level_only = searchParams.get('top_level_only') !== 'false';
    const search = searchParams.get('search') ?? undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined;

    // Lightweight count-only mode — returns { count: N } without fetching rows
    if (countOnly) {
      let query = supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'archived');
      if (status) query = query.eq('status', status);
      if (project_id) query = query.eq('project_id', project_id);
      if (wsScope.workspace_ids) {
        query = query.in('workspace_id', wsScope.workspace_ids);
      } else {
        query = query.eq('workspace_id', wsScope.workspace_id!);
      }
      const { count, error } = await query;
      if (error) throw error;
      return NextResponse.json({ count: count ?? 0 });
    }

    // Fuzzy search by title (for voice task updates)
    if (search) {
      const escaped = search.replace(/[%_]/g, '\\$&');
      let query = supabase
        .from('tasks')
        .select(
          'id, title, description, outcome, status, priority, assignee, project_id, user_id, org_id, workspace_id, category, due_date, source, source_ref, vault_path, time_estimate_minutes, time_spent_minutes, parent_id, spawned_by, context_keys, metadata, effort, depends_on, sort_order, created_at, updated_at, completed_at, archived_at',
        )
        .neq('status', 'archived')
        .ilike('title', `%${escaped}%`)
        .order('updated_at', { ascending: false });
      if (project_id) query = query.eq('project_id', project_id);
      if (wsScope.workspace_ids) {
        query = query.in('workspace_id', wsScope.workspace_ids);
      } else {
        query = query.eq('workspace_id', wsScope.workspace_id!);
      }
      query = query.limit(limit || 500);
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json(data);
    }

    const tasks = await getTasks(supabase, {
      status,
      project_id,
      top_level_only,
      ...wsScope,
    });
    return cachedJson(tasks, 5);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

type CreateTaskBody = z.infer<typeof createTaskSchema>;

export const POST = withApiSecurity<CreateTaskBody>(
  async (request: NextRequest, { userId, body }: SecurityContext<CreateTaskBody>) => {
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

    // Validate assignee is employed in the workspace
    if (body.assignee) {
      const employed = await isAgentEmployed(resolvedWorkspaceId, body.assignee);
      if (!employed) {
        return NextResponse.json(
          { error: `Agent "${body.assignee}" is not employed in this workspace` },
          { status: 422 },
        );
      }
    }

    // Suspension and plan gates, nesting, dependency checks, and the activity row live in the service
    const scope = workspaceScope({ workspaceId: resolvedWorkspaceId, actorId: userId });
    let task;
    try {
      task = await getCoreServices(supabase).tasks.create(scope, input, {
        source: 'web',
        userId,
      });
    } catch (error) {
      const mapped = coreErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }

    runTaskCreatedEffects(task, userId);

    return NextResponse.json(task, { status: 201 });
  },
  {
    permission: 'tasks:create',
    rateLimit: { tier: RATE_WRITE, routeKey: 'tasks.create' },
    parseBody: createTaskSchema,
  },
);
