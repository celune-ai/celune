import { createScope, type WorkspaceScope } from '@celuneai/core';
import { z } from 'zod';
import { resolveWorkspaceFor } from '../host.ts';
import { errorResult, type McpToolResult, type ToolContext } from './types.ts';

export interface ResolvedToolWorkspace {
  workspaceId: string;
  orgId: string | null;
  scope: WorkspaceScope;
}

/** Spread into any tool schema that accepts a workspace override. */
export const workspaceOverrideSchema = {
  workspace_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Target workspace ID. Defaults to the API key's workspace. Use whoami to see available workspaces.",
    ),
};

export async function resolveWorkspace(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ResolvedToolWorkspace | McpToolResult> {
  const requested = params.workspace_id as string | undefined;
  const resolved = await resolveWorkspaceFor(ctx.host, ctx.auth, requested);
  if ('error' in resolved) return errorResult(resolved.error);
  const scope = createScope({
    workspaceId: resolved.workspaceId,
    orgId: resolved.orgId,
    actorId: ctx.auth.userId,
  });
  // A workspace override must pass the same access check as the key's own workspace.
  if (resolved.workspaceId !== ctx.auth.workspaceId) {
    const access = await ctx.services.gate.check('workspace.access', {
      scope,
      userId: ctx.auth.userId,
    });
    if (!access.allowed) {
      const message = access.details?.message;
      return errorResult(typeof message === 'string' ? message : access.reason);
    }
  }
  return { ...resolved, scope };
}

export function isResolveError(
  result: ResolvedToolWorkspace | McpToolResult,
): result is McpToolResult {
  return 'content' in result;
}

export function failure(prefix: string, error: unknown): McpToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return errorResult(`${prefix}: ${message}`);
}
