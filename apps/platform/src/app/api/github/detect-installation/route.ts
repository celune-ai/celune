/**
 * GET /api/github/detect-installation?workspace_id=<id>
 *
 * Detects GitHub App installations for a workspace. Checks active and
 * inactive records already associated with this org, and tries to
 * reactivate inactive ones if they still exist on GitHub.
 *
 * SECURITY: Never uses apps.listInstallations() — that returns ALL global
 * installations across all users and would leak cross-org data. Only
 * installations already registered to this org can be reactivated.
 * New installations must go through the OAuth callback flow.
 *
 * Critical for:
 *   - Local development (GitHub can't redirect to localhost)
 *   - Onboarding (user may not have org_members records yet)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import { createAppOctokit, isGitHubAppConfigured } from '@/lib/github-app';
import type { OrgGitHubInstallation } from '@repo/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Rate limiting
    const rateLimited = await applyRateLimit(request, 'github.detect-installation', RATE_READ);
    if (rateLimited) return rateLimited.blocked;

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    if (!isGitHubAppConfigured()) {
      return NextResponse.json({ found: false, reason: 'github_app_not_configured' });
    }

    const supabase = createServiceClient();

    // Resolve workspace → org (no org_members dependency)
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, org_id, github_installation_id')
      .eq('id', workspaceId)
      .single();

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Workspace ownership verification — onboarding-safe.
    // During onboarding org_memberships/workspace_memberships may be empty,
    // so we check organizations.owner_id first (always populated), then
    // fall back to org_memberships and workspace_memberships.
    const { data: org } = await supabase
      .from('organizations')
      .select('owner_id')
      .eq('id', workspace.org_id)
      .single();

    const isOrgOwner = org?.owner_id === userId;

    if (!isOrgOwner) {
      // Not the org owner — check org_memberships
      const { data: orgMember } = await supabase
        .from('org_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('org_id', workspace.org_id)
        .single();

      if (!orgMember) {
        // Last resort: check workspace_memberships
        const { data: wsMember } = await supabase
          .from('workspace_memberships')
          .select('id')
          .eq('user_id', userId)
          .eq('workspace_id', workspaceId)
          .single();

        if (!wsMember) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }

    // If workspace already has an installation assigned, return it
    if (workspace.github_installation_id) {
      const { data: inst } = await supabase
        .from('org_github_installations')
        .select('installation_id, github_account_login, github_account_avatar_url')
        .eq('installation_id', workspace.github_installation_id)
        .eq('is_active', true)
        .single();

      if (inst) {
        return NextResponse.json({
          found: true,
          installation_id: inst.installation_id,
          account_login: inst.github_account_login,
          account_avatar_url: inst.github_account_avatar_url,
        });
      }
    }

    // Check if ANY installation exists for this org (callback may have registered one)
    const { data: orgInstallations } = await supabase
      .from('org_github_installations')
      .select('installation_id, github_account_login, github_account_avatar_url')
      .eq('org_id', workspace.org_id)
      .eq('is_active', true)
      .limit(1);

    if (orgInstallations && orgInstallations.length > 0) {
      const inst = orgInstallations[0];
      // Auto-assign to workspace
      await supabase
        .from('workspaces')
        .update({ github_installation_id: inst.installation_id })
        .eq('id', workspaceId);

      return NextResponse.json({
        found: true,
        installation_id: inst.installation_id,
        account_login: inst.github_account_login,
        account_avatar_url: inst.github_account_avatar_url,
      });
    }

    // Last resort: try to reactivate INACTIVE installations already registered
    // for this org by verifying they still exist on GitHub.
    // SECURITY: Never use apps.listInstallations() — it returns ALL global
    // installations and would leak cross-org data. New installations must go
    // through the OAuth callback flow (/api/github/callback).
    const { data: inactiveInstallations } = await supabase
      .from('org_github_installations')
      .select('id, installation_id, github_account_login, github_account_avatar_url')
      .eq('org_id', workspace.org_id)
      .eq('is_active', false)
      .order('connected_at', { ascending: false });

    if (!inactiveInstallations || inactiveInstallations.length === 0) {
      return NextResponse.json({ found: false, reason: 'no_installations' });
    }

    // Verify each inactive installation against GitHub and reactivate the first valid one
    const appOctokit = createAppOctokit();
    for (const inst of inactiveInstallations as Pick<
      OrgGitHubInstallation,
      'id' | 'installation_id' | 'github_account_login' | 'github_account_avatar_url'
    >[]) {
      try {
        const { data: ghInst } = await appOctokit.rest.apps.getInstallation({
          installation_id: inst.installation_id,
        });

        // Installation still exists on GitHub — reactivate it
        const acct = ghInst.account as Record<string, unknown> | null;
        const login =
          ((acct?.login ?? acct?.name) as string | undefined) ?? inst.github_account_login;
        const avatarUrl =
          (acct?.avatar_url as string | undefined) ?? inst.github_account_avatar_url;

        await supabase
          .from('org_github_installations')
          .update({
            is_active: true,
            github_account_login: login,
            github_account_avatar_url: avatarUrl,
            connected_by: userId,
          })
          .eq('id', inst.id);

        // Auto-assign to requesting workspace
        await supabase
          .from('workspaces')
          .update({ github_installation_id: inst.installation_id })
          .eq('id', workspaceId);

        return NextResponse.json({
          found: true,
          installation_id: inst.installation_id,
          account_login: login,
          account_avatar_url: avatarUrl,
        });
      } catch {
        // Installation no longer exists on GitHub — skip to next
        continue;
      }
    }

    return NextResponse.json({ found: false, reason: 'no_matching_installations' });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
