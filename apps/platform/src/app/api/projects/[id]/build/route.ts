import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { enqueueServerRun } from '@/lib/execution/queue-manager';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/[id]/build
 *
 * Start or advance the build process for a project.
 * Finds the next eligible sprint's tasks (respecting dependencies)
 * and moves them from inbox/planning → in_progress.
 *
 * Returns the list of tasks that were initiated.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'projects.id.build.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id: projectId } = await params;
    if (!isValidUuid(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id') ?? null;
    const permResult = await requirePermission(request, workspaceId, 'tasks:update');
    if (permResult instanceof NextResponse) return permResult;
    const userId = permResult.userId;

    const supabase = createServiceClient();

    // Verify project exists and user has access
    const { data: project } = await supabase
      .from('projects')
      .select('id, name, status, workspace_id')
      .eq('id', projectId)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.workspace_id) {
      const { data: membership } = await supabase
        .from('workspace_memberships')
        .select('workspace_id')
        .eq('user_id', userId)
        .eq('workspace_id', project.workspace_id)
        .maybeSingle();
      if (!membership) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // Get all non-done tasks for this project, ordered by sprint then created_at
    const { data: allTasks, error: tasksError } = await supabase
      .from('tasks')
      .select('id, title, status, assignee, metadata, depends_on')
      .eq('project_id', projectId)
      .neq('status', 'done')
      .order('created_at', { ascending: true });

    if (tasksError) {
      return safeErrorResponse(tasksError);
    }

    if (!allTasks || allTasks.length === 0) {
      return NextResponse.json({
        initiated: [],
        message: 'No tasks to build — all tasks are done',
        building: false,
      });
    }

    // Collect IDs of done tasks for dependency resolution
    const { data: doneTasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('project_id', projectId)
      .eq('status', 'done');
    const doneIds = new Set((doneTasks ?? []).map((t) => t.id));

    // Also count in_progress tasks — if any are running, the build is already active
    const inProgressTasks = allTasks.filter((t) => t.status === 'in_progress');
    if (inProgressTasks.length > 0) {
      return NextResponse.json({
        initiated: [],
        already_running: inProgressTasks.map((t) => ({ id: t.id, title: t.title })),
        message: `${inProgressTasks.length} task(s) already in progress`,
        building: true,
      });
    }

    // Find the lowest sprint number among remaining tasks
    const getSprint = (t: { metadata: unknown }) => {
      const meta = t.metadata as Record<string, unknown> | null;
      return typeof meta?.sprint === 'number' ? meta.sprint : 999;
    };
    const minSprint = Math.min(...allTasks.map(getSprint));

    // Filter to tasks in the current sprint that are ready to start
    const eligible = allTasks.filter((t) => {
      // Must be in the current sprint
      if (getSprint(t) !== minSprint) return false;
      // Must be in a startable status
      if (!['inbox', 'backlog', 'assigned', 'planning'].includes(t.status)) return false;
      // All dependencies must be done
      const deps = t.depends_on as string[] | null;
      if (deps && deps.length > 0) {
        if (!deps.every((depId) => doneIds.has(depId))) return false;
      }
      return true;
    });

    if (eligible.length === 0) {
      // There are remaining tasks but none are eligible (blocked by deps or wrong status)
      const blocked = allTasks.filter(
        (t) => !['in_progress', 'review', 'done'].includes(t.status),
      );
      return NextResponse.json({
        initiated: [],
        blocked: blocked.map((t) => ({ id: t.id, title: t.title })),
        message: 'No eligible tasks — remaining tasks are blocked by dependencies',
        building: false,
      });
    }

    // Initiate all eligible tasks and enqueue execution jobs
    const now = new Date().toISOString();
    const initiated: { id: string; title: string; assignee: string; execution_id?: string }[] = [];

    // Resolve org_id for execution queue
    let orgId: string | null = null;
    if (project.workspace_id) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('org_id')
        .eq('id', project.workspace_id)
        .single();
      orgId = ws?.org_id ?? null;
    }

    for (const task of eligible) {
      const assignee = task.assignee === 'unassigned' ? 'rick' : task.assignee;
      const meta = (task.metadata ?? {}) as Record<string, unknown>;

      await supabase
        .from('tasks')
        .update({
          status: 'in_progress',
          assignee,
          metadata: {
            ...meta,
            initiated: true,
            initiated_at: now,
            initiated_by: userId ?? 'system',
            active_session: true,
            active_since: now,
            claimed_by: assignee,
            pre_initiate_status: task.status,
          },
        })
        .eq('id', task.id);

      // Enqueue a server run for the agent worker
      let executionId: string | undefined;
      if (project.workspace_id && orgId) {
        const { job, error: queueError } = await enqueueServerRun({
          workspaceId: project.workspace_id,
          userId: userId ?? '',
          orgId,
          targetType: 'task',
          taskId: task.id,
          agentId: assignee,
          context: {
            task_title: task.title,
            project_id: projectId,
            sprint: meta.sprint,
          },
          metadata: { triggered_by: 'project_build' },
        });
        if (job) executionId = job.id;
        else if (queueError) console.warn('[build] execution enqueue skipped:', queueError);
      }

      initiated.push({ id: task.id, title: task.title, assignee, execution_id: executionId });
    }

    // Mark project as building in metadata
    const { data: projFull } = await supabase
      .from('projects')
      .select('metadata')
      .eq('id', projectId)
      .single();
    const projMeta = (projFull?.metadata as Record<string, unknown>) ?? {};
    await supabase
      .from('projects')
      .update({
        metadata: { ...projMeta, building: true, build_started_at: now },
        status: project.status === 'active' ? 'active' : project.status,
      })
      .eq('id', projectId);

    return NextResponse.json({
      initiated,
      message: `${initiated.length} task(s) started in sprint ${minSprint}`,
      building: true,
      sprint: minSprint,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * DELETE /api/projects/[id]/build
 *
 * Cancel the build process. Reverts in_progress tasks that were
 * initiated by the build back to their pre-initiate status.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'projects.id.build.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id: projectId } = await params;
    if (!isValidUuid(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id') ?? null;
    const permResult = await requirePermission(request, workspaceId, 'tasks:update');
    if (permResult instanceof NextResponse) return permResult;
    const userId = permResult.userId;

    const supabase = createServiceClient();

    // Verify access
    const { data: project } = await supabase
      .from('projects')
      .select('id, workspace_id, metadata')
      .eq('id', projectId)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.workspace_id) {
      const { data: membership } = await supabase
        .from('workspace_memberships')
        .select('workspace_id')
        .eq('user_id', userId)
        .eq('workspace_id', project.workspace_id)
        .maybeSingle();
      if (!membership) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // Find in_progress tasks that were initiated by the build
    const { data: runningTasks } = await supabase
      .from('tasks')
      .select('id, title, metadata')
      .eq('project_id', projectId)
      .eq('status', 'in_progress');

    const reverted: { id: string; title: string }[] = [];

    for (const task of runningTasks ?? []) {
      const meta = (task.metadata ?? {}) as Record<string, unknown>;
      if (!meta.initiated) continue;

      const prevStatus = (meta.pre_initiate_status as string) || 'planning';
      await supabase
        .from('tasks')
        .update({
          status: prevStatus,
          metadata: {
            ...meta,
            initiated: false,
            active_session: false,
            cancelled_at: new Date().toISOString(),
            cancelled_by: userId ?? 'system',
          },
        })
        .eq('id', task.id);

      reverted.push({ id: task.id, title: task.title });
    }

    // Clear building flag on project
    const projMeta = (project.metadata as Record<string, unknown>) ?? {};
    await supabase
      .from('projects')
      .update({
        metadata: { ...projMeta, building: false, build_cancelled_at: new Date().toISOString() },
      })
      .eq('id', projectId);

    return NextResponse.json({
      reverted,
      message: `Build cancelled — ${reverted.length} task(s) reverted`,
      building: false,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
