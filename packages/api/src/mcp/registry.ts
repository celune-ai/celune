import { hasScope, type AuthContext } from '../auth/types.ts';
import { claimJob } from './tools/jobs/claim-job.ts';
import { heartbeat } from './tools/jobs/heartbeat.ts';
import { pollPendingJobs } from './tools/jobs/poll-pending-jobs.ts';
import { submitJobResult } from './tools/jobs/submit-job-result.ts';
import { createProject } from './tools/projects/create-project.ts';
import { getProject } from './tools/projects/get-project.ts';
import { listProjects } from './tools/projects/list-projects.ts';
import { addComment } from './tools/tasks/add-comment.ts';
import { blockTask } from './tools/tasks/block-task.ts';
import { claimTask } from './tools/tasks/claim-task.ts';
import { completeTask } from './tools/tasks/complete-task.ts';
import { createTask } from './tools/tasks/create-task.ts';
import { getTask } from './tools/tasks/get-task.ts';
import { listTasks } from './tools/tasks/list-tasks.ts';
import { findTaskByBranch } from './tools/workspace/find-task-by-branch.ts';
import { getWorkspaceInfo } from './tools/workspace/get-workspace-info.ts';
import { getWorkspacePulse } from './tools/workspace/get-workspace-pulse.ts';
import { listAvailableAgents } from './tools/workspace/list-available-agents.ts';
import { whoami } from './tools/workspace/whoami.ts';
import type { McpToolHandler, McpToolScope, ToolContext } from './types.ts';

/** Tools that run on @celuneai/core alone. Hosts add their own through extraTools. */
export const CORE_TOOLS: McpToolHandler[] = [
  listTasks,
  getTask,
  createTask,
  claimTask,
  completeTask,
  blockTask,
  addComment,
  listProjects,
  getProject,
  createProject,
  whoami,
  getWorkspaceInfo,
  getWorkspacePulse,
  findTaskByBranch,
  listAvailableAgents,
  pollPendingJobs,
  claimJob,
  submitJobResult,
  heartbeat,
];

export function scopeSatisfied(toolScope: McpToolScope, auth: AuthContext): boolean {
  if (toolScope === 'public') return true;
  return hasScope(auth, toolScope);
}

/** Merges host tools over the package set; a same-named host tool replaces the package one. */
export function mergeTools<Ctx extends ToolContext>(
  base: McpToolHandler<Ctx>[],
  extra: McpToolHandler<Ctx>[] = [],
): McpToolHandler<Ctx>[] {
  const byName = new Map<string, McpToolHandler<Ctx>>();
  for (const tool of base) byName.set(tool.name, tool);
  for (const tool of extra) byName.set(tool.name, tool);
  return [...byName.values()];
}

export function getAvailableTools<Ctx extends ToolContext>(
  auth: AuthContext,
  tools: McpToolHandler<Ctx>[] = CORE_TOOLS as McpToolHandler<Ctx>[],
): McpToolHandler<Ctx>[] {
  return tools.filter((tool) => scopeSatisfied(tool.scope, auth));
}
