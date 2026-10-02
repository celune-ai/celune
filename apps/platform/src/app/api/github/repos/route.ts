/**
 * GitHub repository management.
 *
 * POST /api/github/repos — Create a new repository and connect it to a workspace.
 * GET  /api/github/repos — List repos accessible under a workspace's installation.
 *
 * All routes verify the installation belongs to the user's org via
 * org_github_installations before accessing GitHub data.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import {
  createRepository,
  listInstallationRepos,
  isGitHubAppConfigured,
  GitHubAppNotConfiguredError,
} from '@/lib/github-app';
import { verifyOrgInstallation } from '@/lib/github-org';
import { validateOrigin } from '@/lib/csrf';
import { githubCreateRepoSchema } from '@/lib/schemas/github.schema';

import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/**
 * GET /api/github/repos?workspace_id=<id>
 * List repos accessible under the workspace's GitHub installation.
 */
export async function GET(request: NextRequest) {
  try {
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

    const rl = await applyRateLimit(request, 'github.repos.get', RATE_READ);
    if (rl) return rl.blocked;

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: membership, error: membershipError } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!membership?.org_id) {
      console.error('[github/repos] No active org membership for user:', userId, membershipError);
      return NextResponse.json(
        { error: 'No organization found. Please complete onboarding or contact support.' },
        { status: 404 },
      );
    }

    // Verify workspace belongs to the user's org
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('org_id', membership.org_id)
      .single();

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Fetch all active org-level installations
    const { data: orgInstallations } = await supabase
      .from('org_github_installations')
      .select('installation_id')
      .eq('org_id', membership.org_id)
      .eq('is_active', true);

    if (!orgInstallations || orgInstallations.length === 0) {
      return NextResponse.json(
        {
          error:
            'No GitHub App installation found for this organization. Connect GitHub from organization settings first.',
        },
        { status: 400 },
      );
    }

    // Aggregate repos from all org installations
    const allRepos: Awaited<ReturnType<typeof listInstallationRepos>> = [];
    const seen = new Set<number>();

    for (const inst of orgInstallations) {
      try {
        const repos = await listInstallationRepos(inst.installation_id);
        for (const repo of repos) {
          if (!seen.has(repo.id)) {
            seen.add(repo.id);
            allRepos.push(repo);
          }
        }
      } catch (ghErr) {
        if (ghErr instanceof GitHubAppNotConfiguredError) {
          return NextResponse.json(
            { error: 'GitHub App is not configured', code: 'github_app_not_configured' },
            { status: 503 },
          );
        }
        const ghMessage = ghErr instanceof Error ? ghErr.message : 'Unknown error';
        console.error(
          `[github/repos] Failed to list repos for installation ${inst.installation_id}:`,
          ghMessage,
        );
        // Auto-deactivate installations that GitHub no longer recognizes
        if (ghMessage.includes('Not Found') || ghMessage.includes('404')) {
          console.warn(`[github/repos] Deactivating stale installation ${inst.installation_id}`);
          await supabase
            .from('org_github_installations')
            .update({ is_active: false })
            .eq('installation_id', inst.installation_id)
            .eq('org_id', membership.org_id);
        }
      }
    }

    if (allRepos.length === 0) {
      return NextResponse.json(
        {
          error:
            'Failed to fetch repositories from GitHub. Check that the GitHub App installation has access to at least one repository.',
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ repos: allRepos });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/github/repos
 * Create a new repository and auto-connect it to the workspace.
 *
 * Body: { workspace_id, name, description?, private?, org? }
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'github.repos.post', RATE_WRITE);
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

    const bodyParsed = githubCreateRepoSchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      return NextResponse.json(
        { error: bodyParsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id, name, description, private: isPrivate, org } = bodyParsed.data;

    const supabase = createServiceClient();

    const { data: membership, error: membershipError } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!membership?.org_id) {
      console.error(
        '[github/repos] POST: No active org membership for user:',
        userId,
        membershipError,
      );
      return NextResponse.json(
        { error: 'No organization found. Please complete onboarding or contact support.' },
        { status: 404 },
      );
    }

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, github_installation_id')
      .eq('id', workspace_id)
      .eq('org_id', membership.org_id)
      .single();

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    if (!workspace.github_installation_id) {
      return NextResponse.json(
        {
          error:
            'No GitHub App installation linked to this workspace. Install the GitHub App first.',
        },
        { status: 400 },
      );
    }

    // Verify installation belongs to this org
    const installation = await verifyOrgInstallation(
      supabase,
      membership.org_id,
      workspace.github_installation_id,
    );
    if (!installation) {
      return NextResponse.json(
        { error: 'Installation not registered for this organization' },
        { status: 400 },
      );
    }

    // Create the repo via GitHub API
    const repo = await createRepository(workspace.github_installation_id, {
      name,
      description: description ?? undefined,
      private: isPrivate ?? true,
      org: org ?? undefined,
      autoInit: true,
    });

    // Auto-connect the new repo to the workspace
    const { data: updated, error } = await supabase
      .from('workspaces')
      .update({
        repo_url: repo.html_url,
        repo_provider: 'github',
        repo_path: '/',
        repo_connected_at: new Date().toISOString(),
        github_default_branch: repo.default_branch,
      })
      .eq('id', workspace_id)
      .select(
        'id, name, slug, repo_url, repo_provider, repo_path, repo_connected_at, github_default_branch',
      )
      .single();

    if (error) return safeErrorResponse(error);

    return NextResponse.json({
      workspace: updated,
      repo,
    });
  } catch (error) {
    if (error instanceof GitHubAppNotConfiguredError) {
      return NextResponse.json(
        { error: 'GitHub App is not configured', code: 'github_app_not_configured' },
        { status: 503 },
      );
    }
    return safeErrorResponse(error);
  }
}
