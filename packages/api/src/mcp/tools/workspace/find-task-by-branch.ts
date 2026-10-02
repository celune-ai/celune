import { z } from 'zod';
import { jsonResult, textResult, type McpToolHandler } from '../../types.ts';
import { isResolveError, resolveWorkspace, workspaceOverrideSchema } from '../../workspace.ts';

const PATTERNS = [
  /(?:feat|fix|task|bug|chore)\/(?:task-)?([a-f0-9]{8,36})/i,
  /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
  /([a-f0-9]{8,12})(?:[-_]|$)/i,
];

export function taskIdPrefixFromBranch(branchName: string): string | null {
  for (const pattern of PATTERNS) {
    const match = branchName.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export const findTaskByBranch: McpToolHandler = {
  name: 'find_task_by_branch',
  description: 'Find a Celune task associated with the current git branch name (pattern matching)',
  schema: z.object({
    ...workspaceOverrideSchema,
    branch_name: z.string().describe('Git branch name, e.g., feat/task-abc12345 or fix/my-feature'),
  }),
  scope: 'public',
  group: 'workspace',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    const branchName = params.branch_name as string;
    const tasks = await ctx.services.tasks.list(resolved.scope, { includeArchived: true });
    const summary = (t: (typeof tasks)[number]) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignee: t.assignee,
      priority: t.priority,
    });

    const prefix = taskIdPrefixFromBranch(branchName);
    if (!prefix) {
      const byMeta = tasks.find(
        (t) => ((t.metadata ?? {}) as Record<string, unknown>).branch === branchName,
      );
      if (byMeta)
        return jsonResult({ match: 'metadata', task: summary(byMeta), branch: branchName });
      return textResult(
        `No task found matching branch "${branchName}". Try using get_task with a specific task ID.`,
      );
    }
    const byPrefix = tasks.find((t) => t.id.startsWith(prefix.toLowerCase()));
    if (byPrefix)
      return jsonResult({ match: 'id_prefix', task: summary(byPrefix), branch: branchName });
    return textResult(
      `No task found matching branch "${branchName}" (searched for ID prefix "${prefix}").`,
    );
  },
};
