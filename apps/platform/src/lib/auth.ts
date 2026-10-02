import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';

/**
 * Returns the authenticated user's ID from the request headers.
 * The middleware injects `x-user-id` for all authenticated API requests.
 * Returns null if the header is missing (e.g., on public routes).
 */
export function getAuthUserId(request: NextRequest): string | null {
  return request.headers.get('x-user-id');
}

/**
 * Resolve the org ID for a given user by looking up their active org membership.
 * Returns null if no active membership is found.
 *
 * This is used to provide the orgId required by resolveProviderKey() in API routes
 * that do not have workspace context available (e.g. voice/transcribe, voice/parse).
 */
export async function getOrgIdForUser(userId: string): Promise<string | null> {
  // Service client: resolves org membership for BYOK key lookup. Accesses: org_members.
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return data?.org_id ?? null;
}

/**
 * Resolve the org ID for a given workspace.
 * Returns null if the workspace is not found.
 */
export async function getOrgIdForWorkspace(workspaceId: string): Promise<string | null> {
  // Service client: resolves org from workspace for BYOK key lookup. Accesses: workspaces.
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('workspaces')
    .select('org_id')
    .eq('id', workspaceId)
    .single();
  return data?.org_id ?? null;
}
