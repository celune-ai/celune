/**
 * Side effects of a task write that live outside the core services: webhooks,
 * notifications, usage metering, and the PRD auto-upload. The cookie routes and
 * the /api/v1 host hook both call these, so the two surfaces behave the same.
 */

import type { Task, TaskMetadata, PrdMetadata } from '@repo/types';
import type { TaskUpdateResult } from '@celuneai/core';
import { updateProject } from '@repo/db/queries';
import { dispatchNotification } from '@repo/notifications';
import { trackUsage } from '@/lib/track-usage';
import { dispatchWebhook } from '@/lib/webhooks';

type SupabaseClient = Parameters<typeof updateProject>[0];

export function runTaskCreatedEffects(task: Task, userId: string): void {
  if (!task.workspace_id) return;
  trackUsage({
    workspace_id: task.workspace_id,
    user_id: userId,
    event_type: 'task_executed',
    quantity: 1,
    unit: 'count',
    metadata: { task_id: task.id, assignee: task.assignee },
  });
  dispatchWebhook(task.workspace_id, 'task.created', {
    task_id: task.id,
    title: task.title,
    status: task.status,
    assignee: task.assignee,
    priority: task.priority,
  });
}

export async function runTaskUpdatedEffects(
  result: Pick<TaskUpdateResult, 'task' | 'previous' | 'statusChanged' | 'completed'>,
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const { task, previous, statusChanged, completed } = result;

  if (task.workspace_id && statusChanged && task.status !== previous.status) {
    dispatchWebhook(task.workspace_id, completed ? 'task.completed' : 'task.updated', {
      task_id: task.id,
      title: task.title,
      status: task.status,
      previous_status: previous.status,
      assignee: task.assignee,
      priority: task.priority,
    });

    if (completed) {
      const agentName = (task.metadata as TaskMetadata)?.claimed_by ?? task.assignee ?? 'rick';
      dispatchNotification({
        type: 'task.completed',
        workspaceId: task.workspace_id,
        actorAgent: agentName,
        payload: {
          task_id: task.id,
          task_title: task.title,
          outcome: task.outcome ?? 'Task completed.',
        },
      }).catch(() => {});
    }
  }

  // Auto-upload PRD content when a PRD task is completed
  if (completed && task.project_id && /prd/i.test(task.title)) {
    const prdContent = task.outcome || task.description;
    if (!prdContent) return;
    const existingProject = await supabase
      .from('projects')
      .select('prd_metadata')
      .eq('id', task.project_id)
      .eq('workspace_id', workspaceId)
      .single();
    const currentPrdMeta = (existingProject.data?.prd_metadata ?? null) as PrdMetadata | null;
    const needsApproval = !currentPrdMeta || currentPrdMeta.status !== 'approved';
    await updateProject(
      supabase,
      task.project_id,
      {
        prd_content: prdContent,
        ...(needsApproval && {
          prd_metadata: {
            author: task.assignee ?? 'unknown',
            status: 'approved' as const,
            agents_involved: task.assignee ? [task.assignee] : [],
            created_date: new Date().toISOString(),
          },
        }),
      },
      workspaceId,
    );
  }
}
