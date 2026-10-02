import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import type { PermissionKey, ResolvedPermissions } from '@repo/types';
import { getAuthUserId } from '@/lib/auth';
import { resolveOrgPermissions, resolvePermissions } from '@/lib/permissions';
import { syncSeats } from '@/lib/billing-seats';

type ServiceClient = ReturnType<typeof createServiceClient>;

/** An org the caller manages that the target user belongs to. */
export interface SharedOrg {
  orgId: string;
  /** The caller's permissions in this org. */
  resolved: ResolvedPermissions;
  /** The target's role slug in this org. */
  targetRole: string | null;
  targetIsOwner: boolean;
}

export type UserScope =
  | {
      callerId: string;
      supabase: ServiceClient;
      platformOwner: true;
      resolved: ResolvedPermissions;
    }
  | { callerId: string; supabase: ServiceClient; platformOwner: false; orgs: SharedOrg[] };

/**
 * Scopes a /api/users/[id] or /api/invitations/[id] action. The platform owner
 * may act on any user. Anyone else acts only through the orgs they share with
 * the target in which they hold `key`; every account also owns the org its
 * signup created, so an action never reaches beyond those shared orgs. A target
 * who shares no org with the caller answers 404; one who shares only orgs where
 * the caller lacks `key` answers 403.
 */
export async function requireUserScope(
  request: NextRequest,
  targetUserId: string,
  key: PermissionKey,
): Promise<UserScope | NextResponse> {
  const callerId = getAuthUserId(request);
  if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();
  const platform = await resolvePermissions(supabase, callerId, '');
  if (platform.isPlatformOwner) {
    return { callerId, supabase, platformOwner: true, resolved: platform };
  }

  const [targetRows, callerRows] = await Promise.all([
    supabase.from('org_members').select('org_id, role_id, is_owner').eq('user_id', targetUserId),
    supabase.from('org_members').select('org_id').eq('user_id', callerId).eq('is_active', true),
  ]);
  if (targetRows.error) throw targetRows.error;
  if (callerRows.error) throw callerRows.error;

  const callerOrgs = new Set((callerRows.data ?? []).map((r) => r.org_id as string));
  const candidates = (targetRows.data ?? []).filter((r) => callerOrgs.has(r.org_id));
  if (candidates.length === 0) return notFound();

  const roleIds = [...new Set(candidates.map((r) => r.role_id as string).filter(Boolean))];
  const slugById = new Map<string, string>();
  if (roleIds.length > 0) {
    const { data: roles, error } = await supabase
      .from('roles')
      .select('id, slug')
      .in('id', roleIds);
    if (error) throw error;
    for (const r of roles ?? []) slugById.set(r.id as string, r.slug as string);
  }

  const orgs: SharedOrg[] = [];
  for (const row of candidates) {
    const resolved = await resolveOrgPermissions(supabase, callerId, row.org_id);
    if (!resolved.permissions.has(key)) continue;
    orgs.push({
      orgId: row.org_id,
      resolved,
      targetRole: row.is_owner ? 'owner' : (slugById.get(row.role_id) ?? null),
      targetIsOwner: Boolean(row.is_owner),
    });
  }
  if (orgs.length === 0) {
    // The caller shares an org with the target but lacks the permission there.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { callerId, supabase, platformOwner: false, orgs };
}

function notFound() {
  return NextResponse.json({ error: 'User not found' }, { status: 404 });
}

/** Removes a user from the given orgs and from those orgs' workspaces, then syncs Cloud seats. */
export async function removeFromOrgs(
  supabase: ServiceClient,
  userId: string,
  orgIds: string[],
): Promise<void> {
  const { data: workspaces, error } = await supabase
    .from('workspaces')
    .select('id')
    .in('org_id', orgIds);
  if (error) throw error;
  const workspaceIds = (workspaces ?? []).map((w) => w.id as string);
  if (workspaceIds.length > 0) {
    const { error: wsError } = await supabase
      .from('workspace_memberships')
      .delete()
      .eq('user_id', userId)
      .in('workspace_id', workspaceIds);
    if (wsError) throw wsError;
  }
  for (const table of ['org_members', 'org_memberships']) {
    const { error: delError } = await supabase
      .from(table)
      .delete()
      .eq('user_id', userId)
      .in('org_id', orgIds);
    if (delError) throw delError;
  }
  await syncSeats(orgIds);
}
