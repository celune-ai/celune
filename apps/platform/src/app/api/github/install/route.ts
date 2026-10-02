/**
 * GitHub App install routes.
 *
 * GET  /api/github/install?workspace_id=<id>
 *   Generates a CSRF state token and redirects to the GitHub App installation page.
 *
 * POST /api/github/install
 *   Returns org-scoped installations for the user's organization.
 *   NEVER lists global installations — only returns installations registered
 *   in org_github_installations for the user's org.
 *
 *   Body: { workspace_id }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import {
  getGitHubAppInstallUrl,
  generateGitHubOAuthState,
  isGitHubAppConfigured,
  GitHubAppNotConfiguredError,
} from '@/lib/github-app';
import { getOrgInstallations } from '@/lib/github-org';
import { validateOrigin } from '@/lib/csrf';
import { githubInstallPostSchema } from '@/lib/schemas/github.schema';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspace_id');

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }
  if (!isValidUuid(workspaceId)) {
    return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
  }

  try {
    // Build HMAC-signed state containing workspace ID + user ID — no cookie needed
    const state = generateGitHubOAuthState(workspaceId, userId);
    const installUrl = getGitHubAppInstallUrl(state);

    return NextResponse.redirect(installUrl);
  } catch (error) {
    if (error instanceof GitHubAppNotConfiguredError) {
      return NextResponse.json(
        {
          error: 'GitHub App is not configured. Contact your administrator.',
          code: 'github_app_not_configured',
        },
        { status: 503 },
      );
    }
    throw error;
  }
}

/**
 * POST /api/github/install — return org-scoped installations.
 *
 * Queries org_github_installations for the user's org. Never lists
 * global GitHub App installations.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'github.install.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    if (!isGitHubAppConfigured()) {
      return NextResponse.json(
        { error: 'GitHub App is not configured', code: 'github_app_not_configured' },
        { status: 503 },
      );
    }

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = githubInstallPostSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id } = parsed.data;

    const supabase = createServiceClient();

    // Verify workspace belongs to user's org
    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!membership?.org_id) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, org_id, github_installation_id')
      .eq('id', workspace_id)
      .eq('org_id', membership.org_id)
      .single();

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // If workspace already has an installation, verify it's registered to this org
    if (workspace.github_installation_id) {
      const installations = await getOrgInstallations(supabase, membership.org_id);
      const match = installations.find(
        (i) => i.installation_id === workspace.github_installation_id,
      );
      if (match) {
        return NextResponse.json({
          found: true,
          installation_id: match.installation_id,
          account: match.github_account_login,
          source: 'existing',
          installations,
        });
      }
      // Installation on workspace doesn't belong to this org — clear it
      await supabase
        .from('workspaces')
        .update({ github_installation_id: null })
        .eq('id', workspace_id);
    }

    // Return all org-level installations for the user to pick from
    const installations = await getOrgInstallations(supabase, membership.org_id);

    if (installations.length === 0) {
      return NextResponse.json({ found: false, reason: 'no_installations', installations: [] });
    }

    // If only one installation, auto-assign it to the workspace
    if (installations.length === 1) {
      await supabase
        .from('workspaces')
        .update({ github_installation_id: installations[0].installation_id })
        .eq('id', workspace_id);

      return NextResponse.json({
        found: true,
        installation_id: installations[0].installation_id,
        account: installations[0].github_account_login,
        source: 'org_auto',
        installations,
      });
    }

    // Multiple installations — return list for user to pick
    return NextResponse.json({
      found: true,
      source: 'org_multiple',
      installations,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
