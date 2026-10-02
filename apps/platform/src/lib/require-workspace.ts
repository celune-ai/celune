import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import type { PermissionContext } from '@/lib/permissions';
import type { WorkspaceScope } from '@repo/db/queries';

export type { WorkspaceScope };

/**
 * Validates that the authenticated user has access to the specified workspace.
 * Owners/platform admins always have access to all workspaces in their org.
 * Other users must be in workspace_memberships.
 */
export async function requireWorkspace(
  context: PermissionContext,
  workspaceId: string | null,
): Promise<NextResponse | null> {
  // Null workspace_id must be rejected — passing null would bypass all checks
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }

  // Owners and platform admins see all workspaces
  if (context.resolved.isOwner || context.resolved.isPlatformOwner) return null;
  // Users with settings:manage have org-wide access
  if (context.resolved.permissions.has('settings:manage')) return null;

  // All others: check workspace_memberships
  const userId = context.userId;
  // Service client: checks workspace membership for authorization; user context already verified upstream. Accesses: workspace_memberships.
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('workspace_memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null; // Access granted
}

/**
 * Extracts a WorkspaceScope from request query params.
 *
 * Returns a 400 error response if neither workspace_id nor workspace_ids is provided.
 * This is the primary guard ensuring all list endpoints are workspace-scoped.
 *
 * Usage:
 *   const wsResult = extractWorkspaceScope(request);
 *   if (wsResult instanceof NextResponse) return wsResult;
 *   const tasks = await getTasks(supabase, { ...wsResult });
 */
export function extractWorkspaceScope(request: NextRequest): WorkspaceScope | NextResponse {
  const searchParams = request.nextUrl.searchParams;
  const workspace_id = searchParams.get('workspace_id');
  const workspace_ids_param = searchParams.get('workspace_ids');
  const workspace_ids = workspace_ids_param
    ? workspace_ids_param.split(',').filter(Boolean)
    : undefined;

  if (workspace_ids && workspace_ids.length > 0) {
    if (workspace_ids.length > 10) {
      return NextResponse.json({ error: 'Too many workspace_ids (max 10)' }, { status: 400 });
    }
    const invalidIds = workspace_ids.filter((id) => !isValidUuid(id));
    if (invalidIds.length > 0) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }
    return { workspace_ids };
  }
  if (workspace_id) {
    if (!isValidUuid(workspace_id)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }
    return { workspace_id };
  }

  return NextResponse.json(
    { error: 'workspace_id or workspace_ids query parameter is required' },
    { status: 400 },
  );
}

/**
 * Extracts a single required workspace_id from request query params.
 *
 * Returns a 400 error response if workspace_id is not provided.
 * Use this instead of extractWorkspaceScope when the route only needs
 * a single workspace_id string (not the WorkspaceScope union).
 *
 * Usage:
 *   const wsResult = extractRequiredWorkspaceId(request);
 *   if (wsResult instanceof NextResponse) return wsResult;
 *   // wsResult is now a string (the workspace_id)
 */
/**
 * Lightweight membership check: verifies the user belongs to the workspace.
 * Returns a 403 NextResponse on failure, null on success.
 */
export async function requireWorkspaceMembership(
  userId: string,
  workspaceId: string,
): Promise<NextResponse | null> {
  if (!isValidUuid(workspaceId)) {
    return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
  }
  const supabase = createServiceClient();

  // Check if user is org owner/admin for the workspace's org
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('org_id')
    .eq('id', workspaceId)
    .single();
  if (workspace?.org_id) {
    const { data: orgMember } = await supabase
      .from('org_memberships')
      .select('role')
      .eq('user_id', userId)
      .eq('org_id', workspace.org_id)
      .single();
    if (orgMember?.role === 'owner' || orgMember?.role === 'admin') return null;
  }

  // Check workspace membership
  const { data } = await supabase
    .from('workspace_memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();
  if (!data) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

/**
 * Combines extractWorkspaceScope + auth + membership verification in one call.
 * Returns a WorkspaceScope on success, or a NextResponse error on failure.
 *
 * Use this instead of bare `extractWorkspaceScope` in all routes that need auth.
 */
export async function requireWorkspaceScope(
  request: NextRequest,
): Promise<WorkspaceScope | NextResponse> {
  // 1. Extract workspace scope from query params
  const wsScope = extractWorkspaceScope(request);
  if (wsScope instanceof NextResponse) return wsScope;

  // 2. Auth check
  const { getAuthUserId } = await import('@/lib/auth');
  const userId = getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 3. Verify membership for each workspace in the scope
  const wsIds = 'workspace_ids' in wsScope ? wsScope.workspace_ids! : [wsScope.workspace_id!];
  for (const wsId of wsIds) {
    const membershipError = await requireWorkspaceMembership(userId, wsId);
    if (membershipError) return membershipError;
  }

  return wsScope;
}

export function extractRequiredWorkspaceId(request: NextRequest): string | NextResponse {
  const workspace_id = request.nextUrl.searchParams.get('workspace_id');
  if (!workspace_id) {
    return NextResponse.json(
      { error: 'workspace_id query parameter is required' },
      { status: 400 },
    );
  }
  if (!isValidUuid(workspace_id)) {
    return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
  }
  return workspace_id;
}
