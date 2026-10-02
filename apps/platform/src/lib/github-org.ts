/**
 * Org-level GitHub installation verification.
 *
 * Used by all GitHub API routes to ensure the requested installation
 * belongs to the authenticated user's organization.
 */

import type { OrgGitHubInstallation } from '@repo/types';
import { createServiceClient } from '@repo/db/service';

type SupabaseClient = ReturnType<typeof createServiceClient>;

/**
 * Verify that a GitHub installation belongs to the given organization.
 * Returns the installation record or null if not found/not owned.
 */
export async function verifyOrgInstallation(
  supabase: SupabaseClient,
  orgId: string,
  installationId: number,
): Promise<OrgGitHubInstallation | null> {
  const { data } = await supabase
    .from('org_github_installations')
    .select('*')
    .eq('org_id', orgId)
    .eq('installation_id', installationId)
    .eq('is_active', true)
    .single();

  return data ?? null;
}

/**
 * Get all active GitHub installations for an organization.
 */
export async function getOrgInstallations(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgGitHubInstallation[]> {
  const { data } = await supabase
    .from('org_github_installations')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('connected_at', { ascending: false });

  return data ?? [];
}

/**
 * Whether the organization has ever connected GitHub, active or not. A missing
 * row means GitHub was never connected, so there is nothing to report as removed.
 */
export async function orgHasAnyInstallation(
  supabase: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from('org_github_installations')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);

  return (count ?? 0) > 0;
}

/**
 * Register a new GitHub installation for an organization.
 * Supports multi-org: the same installation_id can be registered to
 * multiple Celune orgs (e.g., user with access to personal + work GitHub orgs).
 * Returns the created/updated record, or null on duplicate within same org.
 */
export async function registerOrgInstallation(
  supabase: SupabaseClient,
  orgId: string,
  installationId: number,
  accountLogin: string,
  accountAvatarUrl: string | null,
  accountType: 'Organization' | 'User',
  connectedBy: string,
): Promise<OrgGitHubInstallation | null> {
  // Check if this installation is already registered to THIS org.
  const { data: existing } = await supabase
    .from('org_github_installations')
    .select('id, org_id, is_active')
    .eq('installation_id', installationId)
    .eq('org_id', orgId)
    .single();

  if (existing) {
    // Same org — reactivate or update metadata
    const PLACEHOLDER_LOGINS = new Set(['unknown', 'pending-sync', '']);
    const updates: Record<string, unknown> = {
      github_account_type: accountType,
      connected_by: connectedBy,
      is_active: true,
    };
    if (!PLACEHOLDER_LOGINS.has(accountLogin)) {
      updates.github_account_login = accountLogin;
      updates.github_account_avatar_url = accountAvatarUrl;
    }
    const { data, error } = await supabase
      .from('org_github_installations')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // New installation for this org — insert
  // (may already exist in other orgs, that's fine)
  const { data, error } = await supabase
    .from('org_github_installations')
    .insert({
      org_id: orgId,
      installation_id: installationId,
      github_account_login: accountLogin,
      github_account_avatar_url: accountAvatarUrl,
      github_account_type: accountType,
      connected_by: connectedBy,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    // Race condition: same org+installation inserted concurrently
    if (error.code === '23505') return null;
    throw error;
  }

  return data;
}

/**
 * Disconnect a GitHub installation from an organization.
 * Cascades: clears workspace fields, deletes cached tokens, soft-deletes the record.
 * Returns the list of affected workspace IDs.
 */
export async function disconnectOrgInstallation(
  supabase: SupabaseClient,
  orgId: string,
  installationId: number,
): Promise<string[]> {
  // Find affected workspaces
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('org_id', orgId)
    .eq('github_installation_id', installationId);

  const affectedIds = (workspaces ?? []).map((w: { id: string }) => w.id);

  if (affectedIds.length > 0) {
    // Clear GitHub fields from affected workspaces
    await supabase
      .from('workspaces')
      .update({
        github_installation_id: null,
        repo_url: null,
        repo_provider: 'github',
        repo_path: null,
        repo_connected_at: null,
        github_default_branch: 'main',
      })
      .eq('org_id', orgId)
      .eq('github_installation_id', installationId);

    // Delete cached tokens for affected workspaces
    await supabase.from('workspace_github_tokens').delete().in('workspace_id', affectedIds);
  }

  // Soft-delete the installation record
  await supabase
    .from('org_github_installations')
    .update({ is_active: false })
    .eq('org_id', orgId)
    .eq('installation_id', installationId);

  return affectedIds;
}
