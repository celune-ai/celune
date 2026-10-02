import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { createInstallationOctokit } from '@/lib/github-app';
import { parseGitHubUrl } from '@/lib/github-utils';
import { verifyOrgInstallation } from '@/lib/github-org';
import { validateOrigin } from '@/lib/csrf';
import { githubPatchPrSchema } from '@/lib/schemas/github.schema';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/**
 * GET /api/github/prs/[number]?workspace_id=X&tab=timeline|files|reviews|checks
 * Fetch detailed PR data from GitHub for the heavy detail view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  try {
    const { number: prNumberStr } = await params;
    const prNumber = parseInt(prNumberStr, 10);
    if (isNaN(prNumber)) {
      return NextResponse.json({ error: 'Invalid PR number' }, { status: 400 });
    }

    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id');
    const tab = searchParams.get('tab') ?? 'timeline';

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();

    // Get workspace for GitHub connection info
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('org_id, repo_url, github_installation_id')
      .eq('id', workspaceId)
      .single();

    if (!workspace?.repo_url || !workspace.github_installation_id) {
      return NextResponse.json({ error: 'No GitHub repo connected' }, { status: 400 });
    }

    // Verify installation belongs to the workspace's org
    if (workspace.org_id) {
      const orgInstall = await verifyOrgInstallation(
        supabase,
        workspace.org_id,
        workspace.github_installation_id,
      );
      if (!orgInstall) {
        return NextResponse.json(
          { error: 'Installation not registered for this organization' },
          { status: 400 },
        );
      }
    }

    const parsed = parseGitHubUrl(workspace.repo_url);
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid repo URL' }, { status: 400 });
    }

    const octokit = await createInstallationOctokit(workspace.github_installation_id);
    const { owner, repo } = parsed;

    switch (tab) {
      case 'timeline': {
        // Fetch commits and timeline events
        const [{ data: commits }, { data: pr }] = await Promise.all([
          octokit.rest.pulls.listCommits({ owner, repo, pull_number: prNumber, per_page: 100 }),
          octokit.rest.pulls.get({ owner, repo, pull_number: prNumber }),
        ]);

        return NextResponse.json({
          pr: {
            title: pr.title,
            body: pr.body,
            state: pr.state,
            draft: pr.draft,
            merged: pr.merged,
            user: pr.user?.login,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            merged_at: pr.merged_at,
            head: pr.head.ref,
            base: pr.base.ref,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files,
          },
          commits: commits.map((c) => ({
            sha: c.sha.slice(0, 7),
            message: c.commit.message.split('\n')[0],
            author: c.commit.author?.name ?? c.author?.login,
            date: c.commit.author?.date,
          })),
        });
      }

      case 'files': {
        const { data: files } = await octokit.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 300,
        });

        return NextResponse.json({
          files: files.map((f) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            changes: f.changes,
            patch: f.patch?.slice(0, 500), // truncate large patches
          })),
          total: files.length,
        });
      }

      case 'reviews': {
        const [{ data: reviews }, { data: comments }] = await Promise.all([
          octokit.rest.pulls.listReviews({ owner, repo, pull_number: prNumber, per_page: 100 }),
          octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: prNumber,
            per_page: 100,
          }),
        ]);

        return NextResponse.json({
          reviews: reviews.map((r) => ({
            id: r.id,
            user: r.user?.login,
            state: r.state,
            body: r.body,
            submitted_at: r.submitted_at,
          })),
          comments: comments.map((c) => ({
            id: c.id,
            user: c.user?.login,
            body: c.body,
            path: c.path,
            line: c.line,
            created_at: c.created_at,
          })),
        });
      }

      case 'checks': {
        // Get the head SHA from our DB or fetch from PR
        const { data: prRecord } = await supabase
          .from('project_prs')
          .select('head_sha')
          .eq('workspace_id', workspaceId)
          .eq('pr_number', prNumber)
          .single();

        let ref = prRecord?.head_sha;
        if (!ref) {
          const { data: pr } = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: prNumber,
          });
          ref = pr.head.sha;
        }

        const { data: checkRuns } = await octokit.rest.checks.listForRef({
          owner,
          repo,
          ref,
          per_page: 100,
        });

        return NextResponse.json({
          checks: checkRuns.check_runs.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            conclusion: c.conclusion,
            started_at: c.started_at,
            completed_at: c.completed_at,
            html_url: c.html_url,
          })),
          total: checkRuns.total_count,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown tab: ${tab}` }, { status: 400 });
    }
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * PATCH /api/github/prs/[number] — Update a project PR record.
 * Used by webhook handler and manual status updates.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'github.prs.number.patch', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { number: prNumberStr } = await params;
    const prNumber = parseInt(prNumberStr, 10);
    if (isNaN(prNumber)) {
      return NextResponse.json({ error: 'Invalid PR number' }, { status: 400 });
    }

    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const bodyParsed = githubPatchPrSchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      return NextResponse.json(
        { error: bodyParsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id, ...safeUpdates } = bodyParsed.data;

    const membershipError = await requireWorkspaceMembership(userId, workspace_id);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('project_prs')
      .update(safeUpdates)
      .eq('workspace_id', workspace_id)
      .eq('pr_number', prNumber)
      .select()
      .single();

    if (error) return safeErrorResponse(error);
    return NextResponse.json(data);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
