/**
 * Multi-workspace resolver for MCP tools.
 *
 * Resolves the effective workspace from an optional `workspace_id` tool param.
 * If provided, validates the user has membership before allowing access.
 * Falls back to the credential's default workspace when omitted (backward compatible).
 * Host-minted JWTs are pinned to their workspace_id claim; membership is the host's job.
 */

import { z } from 'zod';
import type { AuthContext } from '@celuneai/api';
import type { createServiceClient } from '@repo/db/service';
import { errorResult } from './types';
import type { McpToolResult } from './types';

/** Resolved workspace context returned to tool handlers. */
export interface ResolvedWorkspace {
  workspaceId: string;
  orgId: string | null;
}

/** Shared Zod fragment — spread into any tool schema that needs workspace override. */
export const workspaceOverrideSchema = {
  workspace_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Target workspace ID. Defaults to the API key's workspace. Use whoami to list available workspaces.",
    ),
};

/**
 * Resolve the effective workspace for a tool call.
 *
 * Returns ResolvedWorkspace on success, or McpToolResult (error) on failure.
 */
/** Membership check shared by the MCP tools and the platform ApiHost. */
export async function resolveWorkspaceAccess(
  auth: AuthContext,
  requestedId: string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<ResolvedWorkspace | { error: string }> {
  if (requestedId === auth.workspaceId) {
    return { workspaceId: auth.workspaceId, orgId: auth.orgId };
  }
  if (auth.principal === 'jwt') {
    return { error: 'Token is scoped to another workspace' };
  }

  const { data: workspace, error: wsError } = await supabase
    .from('workspaces')
    .select('id, org_id')
    .eq('id', requestedId)
    .single();

  if (wsError || !workspace) {
    return { error: 'Workspace not found' };
  }

  if (workspace.org_id) {
    const { data: orgMember } = await supabase
      .from('org_memberships')
      .select('role')
      .eq('user_id', auth.userId)
      .eq('org_id', workspace.org_id)
      .single();

    if (orgMember?.role === 'owner' || orgMember?.role === 'admin') {
      return { workspaceId: requestedId, orgId: workspace.org_id };
    }
  }

  const { data: membership } = await supabase
    .from('workspace_memberships')
    .select('id')
    .eq('user_id', auth.userId)
    .eq('workspace_id', requestedId)
    .single();

  if (!membership) {
    return { error: 'You do not have access to this workspace' };
  }

  return { workspaceId: requestedId, orgId: workspace.org_id };
}

export async function resolveWorkspace(
  params: Record<string, unknown>,
  auth: AuthContext,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<ResolvedWorkspace | McpToolResult> {
  const requestedId = params.workspace_id as string | undefined;
  if (!requestedId) {
    return { workspaceId: auth.workspaceId, orgId: auth.orgId };
  }
  const resolved = await resolveWorkspaceAccess(auth, requestedId, supabase);
  if ('error' in resolved) return errorResult(resolved.error);
  return resolved;
}

export function isResolveError(result: ResolvedWorkspace | McpToolResult): result is McpToolResult {
  return 'content' in result && 'isError' in result;
}
