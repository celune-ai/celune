/**
 * Reply to a PR review comment on GitHub.
 *
 * POST /api/github/reviews/reply
 * Body: { workspace_id, pr_number, comment_id, body }
 *
 * Used to notify on GitHub when a finding task is resolved.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { replyToPRComment } from '@/lib/github-git';
import { verifyOrgInstallation } from '@/lib/github-org';
import { githubReplySchema } from '@/lib/schemas/github.schema';
import { validateOrigin } from '@/lib/csrf';
import { safeErrorResponse } from '@/lib/api-error';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'github.reviews.reply.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = githubReplySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id, pr_number, comment_id, body } = parsed.data;

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();

    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id, org_id, repo_url, github_installation_id')
      .eq('id', workspace_id)
      .single();

    if (wsError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    if (!workspace.github_installation_id) {
      return NextResponse.json({ error: 'No GitHub App installation connected' }, { status: 400 });
    }

    if (!workspace.repo_url) {
      return NextResponse.json({ error: 'No repository connected' }, { status: 400 });
    }

    // Verify installation belongs to the workspace's org
    if (workspace.org_id) {
      const installation = await verifyOrgInstallation(
        supabase,
        workspace.org_id,
        workspace.github_installation_id,
      );
      if (!installation) {
        return NextResponse.json(
          { error: 'Installation not registered for this organization' },
          { status: 400 },
        );
      }
    }

    const repoMatch = workspace.repo_url.match(/github\.com\/(.+?)(?:\.git)?$/);
    if (!repoMatch) {
      return NextResponse.json({ error: 'Invalid repo URL format' }, { status: 400 });
    }
    const repoFullName = repoMatch[1];

    const reply = await replyToPRComment(
      workspace.github_installation_id,
      repoFullName,
      pr_number,
      comment_id,
      body,
    );

    return NextResponse.json({
      ok: true,
      comment_id: reply.id,
      comment_url: reply.html_url,
    });
  } catch (error) {
    console.error('[github-reviews] Error replying to comment:', error);
    return safeErrorResponse(error);
  }
}
