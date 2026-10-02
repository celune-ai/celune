import type { Task } from '@repo/types';
import { z } from 'zod';
import { errorResult, jsonResult, type McpToolHandler, type ToolContext } from '../../types.ts';
import {
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
  type ResolvedToolWorkspace,
} from '../../workspace.ts';

async function findByIdOrPrefix(
  ctx: ToolContext,
  resolved: ResolvedToolWorkspace,
  taskId: string,
): Promise<Task | null> {
  if (taskId.length >= 36) {
    return ctx.services.tasks.get(resolved.scope, taskId).catch(() => null);
  }
  const rows = await ctx.services.tasks.list(resolved.scope, { includeArchived: true });
  return rows.find((t) => t.id.startsWith(taskId)) ?? null;
}

export const getTask: McpToolHandler = {
  name: 'get_task',
  description: 'Get a single task with comments, execution logs, and agent activity',
  schema: z.object({
    ...workspaceOverrideSchema,
    task_id: z.string().describe('Task UUID or UUID prefix (min 8 chars)'),
  }),
  scope: 'read',
  group: 'tasks',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    const task = await findByIdOrPrefix(ctx, resolved, params.task_id as string);
    if (!task) return errorResult('Error: Task not found');

    const { store, agents } = ctx.services;
    const [comments, activity, statuses] = await Promise.all([
      store.comments.list(resolved.scope, task.id),
      store.activity.list(resolved.scope, { task_id: task.id, limit: 10 }),
      task.assignee ? agents.listStatus(resolved.scope) : Promise.resolve([]),
    ]);
    const agentRow = statuses.find((s) => s.agent_name === task.assignee) ?? null;
    const meta = (task.metadata ?? {}) as Record<string, unknown>;
    const lastActivity = activity.data[0]?.created_at;
    const timeSinceActivity = lastActivity
      ? `${Math.round((Date.now() - new Date(lastActivity).getTime()) / 60000)}m ago`
      : 'no activity recorded';

    return jsonResult({
      ...task,
      comments,
      recent_activity: activity.data.map((l) => ({
        event: l.event_type,
        title: l.title,
        agent: l.agent_id,
        at: l.created_at,
      })),
      agent_state: agentRow
        ? {
            status: agentRow.status,
            working_on_this: agentRow.current_task_id === task.id,
            last_heartbeat: agentRow.last_heartbeat,
          }
        : null,
      time_since_last_activity: timeSinceActivity,
      claimed_by: meta.claimed_by ?? null,
      active_session: meta.active_session ?? false,
    });
  },
};
