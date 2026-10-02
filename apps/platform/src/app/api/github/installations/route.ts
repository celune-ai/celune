/**
 * Org-level GitHub installation management.
 *
 * GET /api/github/installations?org_id=<id>
 *   List all active GitHub installations for the org. had_installation is true when
 *   the org has ever connected GitHub, so clients can tell removed from never connected.
 *
 * DELETE /api/github/installations
 *   Disconnect GitHub from a workspace (clears github_installation_id).
 *   Body: { workspace_id }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { getOrgInstallations, orgHasAnyInstallation } from '@/lib/github-org';
import { isValidUuid } from '@repo/db/validation';
import { createInstallationOctokit, isGitHubAppConfigured } from '@/lib/github-app';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { requireWorkspaceMembership } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Resolve org via org_members first, fall back to workspace lookup during onboarding
    let orgId: string | null = null;

    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .single();

    orgId = membership?.org_id ?? null;

    if (!orgId) {
      // Fallback: resolve org from user's workspace membership (org_members may not exist during onboarding)
      const { data: wsMembership } = await supabase
        .from('workspace_memberships')
        .select('workspace_id, workspaces!inner(org_id)')
        .eq('user_id', userId)
        .limit(1)
        .single();
      orgId =
        wsMembership?.workspaces &&
        typeof wsMembership.workspaces === 'object' &&
        'org_id' in wsMembership.workspaces
          ? (wsMembership.workspaces as { org_id: string }).org_id
          : null;
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    let installations = await getOrgInstallations(supabase, orgId);
    const hadInstallation =
      installations.length > 0 || (await orgHasAnyInstallation(supabase, orgId));

    // Verify installations are still active on GitHub (catches uninstalls when webhook missed).
    // Only deactivate on explicit 404 from GitHub — NOT on config/network/OpenSSL errors,
    // which would incorrectly nuke valid installations on localhost.
    // Also lazy-sync: if the stored login is a placeholder, update it with real data.
    const PLACEHOLDER_LOGINS = new Set(['unknown', 'pending-sync', '']);
    if (installations.length > 0 && isGitHubAppConfigured()) {
      const verified = [];
      for (const inst of installations) {
        try {
          const octokit = await createInstallationOctokit(inst.installation_id);
          const { data: ghInst } = await octokit.rest.apps.getInstallation({
            installation_id: inst.installation_id,
          });

          // Lazy-sync: update stale metadata with real GitHub account data
          if (ghInst.account) {
            const account = ghInst.account;
            const login =
              ('login' in account ? account.login : 'name' in account ? account.name : null) ??
              'unknown';
            const avatarUrl = account.avatar_url ?? null;
            const accountType =
              'type' in account && account.type === 'Organization' ? 'Organization' : 'User';

            const needsUpdate =
              PLACEHOLDER_LOGINS.has(inst.github_account_login) ||
              inst.github_account_type !== accountType ||
              (avatarUrl && inst.github_account_avatar_url !== avatarUrl);

            if (needsUpdate && login !== 'unknown') {
              await supabase
                .from('org_github_installations')
                .update({
                  github_account_login: login,
                  github_account_avatar_url: avatarUrl,
                  github_account_type: accountType,
                })
                .eq('installation_id', inst.installation_id);

              inst.github_account_login = login;
              inst.github_account_avatar_url = avatarUrl;
              inst.github_account_type = accountType;
            }
          }

          verified.push(inst);
        } catch (err: unknown) {
          const status = (err as { status?: number })?.status;
          const message = err instanceof Error ? err.message : '';
          if (status === 404 || message.includes('Not Found')) {
            // GitHub confirmed: installation no longer exists — deactivate it
            await supabase
              .from('org_github_installations')
              .update({ is_active: false })
              .eq('installation_id', inst.installation_id);
            await supabase
              .from('workspaces')
              .update({ github_installation_id: null })
              .eq('github_installation_id', inst.installation_id);
          } else {
            // Config/network/OpenSSL error — keep the installation, skip verification
            verified.push(inst);
          }
        }
      }
      installations = verified;
    }

    return NextResponse.json({ installations, had_installation: hadInstallation });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const rateLimitResult = await applyRateLimit(request, 'github.installations.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const workspaceId =
      body && typeof body === 'object' && 'workspace_id' in body
        ? (body as { workspace_id: unknown }).workspace_id
        : null;

    if (typeof workspaceId !== 'string' || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    // Verify the user has access to this workspace
    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    const { error } = await supabase
      .from('workspaces')
      .update({ github_installation_id: null })
      .eq('id', workspaceId);

    if (error) return safeErrorResponse(error);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
