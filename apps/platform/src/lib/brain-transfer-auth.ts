import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { isValidUuid } from '@repo/db/validation';
import { createServiceClient } from '@repo/db/service';
import type { ApiKeyScope, PermissionKey } from '@repo/types';
import { authenticateApiKey, requireScope } from '@/lib/api-key-auth';
import { resolvePermissions } from '@/lib/permissions';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { logPermissionDenied } from '@/lib/security-audit';

export interface BrainTransferActor {
  workspaceId: string;
  userId: string;
  via: 'api_key' | 'session';
}

// API keys inherit the RBAC of the user who owns them in the key's workspace.
async function requireKeys(
  userId: string,
  workspaceId: string,
  keys: PermissionKey[],
): Promise<NextResponse | null> {
  if (keys.length === 0) return null;
  // Service client: resolves RBAC for the caller in one workspace. Accesses: org_members, workspace_memberships, role_permissions.
  const resolved = await resolvePermissions(createServiceClient(), userId, workspaceId);
  const missing = keys.filter((key) => !resolved.permissions.has(key));
  if (missing.length === 0) return null;
  logPermissionDenied(userId, missing.join(','), workspaceId);
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * API key first (workspace comes from the key), then session auth with a
 * workspace_id query parameter and a membership check. Both paths then
 * require the given RBAC permission keys in that workspace.
 */
export async function authorizeBrainTransfer(
  request: NextRequest,
  scope: ApiKeyScope,
  permissions: PermissionKey[],
): Promise<BrainTransferActor | NextResponse> {
  const apiKey = await authenticateApiKey(request);
  if (apiKey instanceof NextResponse) return apiKey;
  if (apiKey) {
    const denied = requireScope(apiKey, scope);
    if (denied) return denied;
    const forbidden = await requireKeys(apiKey.userId, apiKey.workspaceId, permissions);
    if (forbidden) return forbidden;
    return { workspaceId: apiKey.workspaceId, userId: apiKey.userId, via: 'api_key' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  if (!workspaceId || !isValidUuid(workspaceId)) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }
  const membershipError = await requireWorkspaceMembership(user.id, workspaceId);
  if (membershipError) return membershipError;
  const forbidden = await requireKeys(user.id, workspaceId, permissions);
  if (forbidden) return forbidden;

  return { workspaceId, userId: user.id, via: 'session' };
}
