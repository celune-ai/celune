import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getTask, updateTask, createActivity } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import type { TaskMetadata } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';
import { enqueueServerRun } from '@/lib/execution/queue-manager';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

// Agent IDs are now short names directly — no mapping needed

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'tasks.id.initiate.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    const workspaceId = request.nextUrl.searchParams.get('workspace_id') ?? null;
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const permResult = await requirePermission(request, workspaceId, 'tasks:update');
    if (permResult instanceof NextResponse) return permResult;
    const userId = permResult.userId;

    // Security: verify the caller is a member of the workspace
    const { data: membership } = await (
      await createClient()
    )
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const supabase = await createClient();
    const task = await getTask(supabase, id, workspaceId);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.status === 'done') {
      return NextResponse.json({ error: 'Cannot initiate a completed task' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const meta = (task.metadata ?? {}) as TaskMetadata;
    const assignee = task.assignee === 'unassigned' ? 'rick' : task.assignee;

    const updated = await updateTask(
      supabase,
      id,
      {
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
      },
      workspaceId,
    );

    // Upsert agent_status so the team page reflects the active agent
    const statusRow: Record<string, unknown> = {
      agent_name: assignee,
      status: 'working' as const,
      current_task_id: id,
      last_heartbeat: now,
      updated_at: now,
    };
    if (workspaceId) statusRow.workspace_id = workspaceId;

    await supabase.from('agent_status').upsert(statusRow, {
      onConflict: workspaceId ? 'workspace_id,agent_name' : 'workspace_id,agent_name',
    });

    // Log heartbeat event for task start
    if (workspaceId) {
      await supabase
        .from('heartbeat_events')
        .insert({
          workspace_id: workspaceId,
          agent_id: assignee,
          event_type: 'task_started',
          metadata: { task_id: id, task_title: task.title },
        })
        .then(({ error }) => {
          if (error) console.error('[initiate] heartbeat_event insert failed:', error.message);
        });
    }

    await createActivity(supabase, {
      event_type: 'task.initiated',
      severity: 'info',
      source: 'web',
      title: `Task initiated: ${task.title}`,
      task_id: id,
      agent_id: assignee,
    });

    // Enqueue a server run for the agent worker
    let executionId: string | null = null;
    if (task.workspace_id && task.org_id) {
      const { job, error: queueError } = await enqueueServerRun({
        workspaceId: task.workspace_id,
        userId: userId ?? '',
        orgId: task.org_id,
        targetType: 'task',
        taskId: id,
        agentId: assignee,
        priority: task.priority === 'urgent' ? 10 : task.priority === 'high' ? 5 : 0,
        context: {
          task_title: task.title,
          task_description: task.description,
          task_priority: task.priority,
          project_id: task.project_id,
        },
      });
      if (job) {
        executionId = job.id;
      } else if (queueError) {
        console.warn('[initiate] execution enqueue skipped:', queueError);
      }
    }

    return NextResponse.json({ ...updated, execution_id: executionId });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
