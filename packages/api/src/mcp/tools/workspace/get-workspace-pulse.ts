import { z } from 'zod';
import { jsonResult, type McpToolHandler } from '../../types.ts';
import { isResolveError, resolveWorkspace, workspaceOverrideSchema } from '../../workspace.ts';

const ACTIVE = new Set(['in_progress', 'review', 'planning', 'scoping']);
const STALE_MINUTES = 120;

type Stamped = { updated_at: string; completed_at: string | null };

function byDesc(field: keyof Stamped) {
  return (a: Stamped, b: Stamped) => String(b[field] ?? '').localeCompare(String(a[field] ?? ''));
}

export const getWorkspacePulse: McpToolHandler = {
  name: 'get_workspace_pulse',
  description:
    'Get a live summary of workspace activity: active tasks, agent states, recent completions, blockers',
  schema: z.object({ ...workspaceOverrideSchema }),
  scope: 'public',
  group: 'workspace',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    const [tasks, agents, done] = await Promise.all([
      ctx.services.tasks.list(resolved.scope),
      ctx.services.agents.listStatus(resolved.scope),
      ctx.services.tasks.list(resolved.scope, { status: 'done', limit: 50 }),
    ]);
    const activeTasks = tasks
      .filter((t) => ACTIVE.has(t.status))
      .sort(byDesc('updated_at'))
      .slice(0, 20);
    const recentCompletions = [...done].sort(byDesc('completed_at')).slice(0, 5);
    const now = Date.now();

    return jsonResult({
      timestamp: new Date(now).toISOString(),
      active_tasks: {
        count: activeTasks.length,
        items: activeTasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          assignee: t.assignee,
          priority: t.priority,
        })),
      },
      agent_states: agents.map((a) => ({
        name: a.agent_name,
        status: a.status,
        working_on: a.current_task_id,
        last_seen: a.last_heartbeat,
      })),
      recent_completions: recentCompletions.map((t) => ({
        id: t.id,
        title: t.title,
        by: t.assignee,
        at: t.completed_at,
      })),
      needs_attention: activeTasks
        .filter((t) => (now - new Date(t.updated_at).getTime()) / 60000 > STALE_MINUTES)
        .map((t) => ({ id: t.id, title: t.title, reason: 'No update in 2+ hours' })),
    });
  },
};
