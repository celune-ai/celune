/**
 * Submit a code review on a GitHub PR.
 *
 * POST /api/github/reviews
 * Body: { workspace_id, pr_number, event, body, comments? }
 *
 * Used by SCAN agent (and other agents) to post structured reviews.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { submitPRReview } from '@/lib/github-git';
import { verifyOrgInstallation } from '@/lib/github-org';
import { validateOrigin } from '@/lib/csrf';
import { githubReviewSchema } from '@/lib/schemas/github.schema';
import { safeErrorResponse } from '@/lib/api-error';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'github.reviews.post', RATE_WRITE);
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

    const parsed = githubReviewSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id, pr_number, event, body, comments } = parsed.data;

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Verify org membership
    let orgId: string | null = null;
    {
      const { data: membership } = await supabase
        .from('org_members')
        .select('org_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .single();
      orgId = membership?.org_id ?? null;
    }

    // Look up workspace to get GitHub installation and repo info
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id, org_id, repo_url, github_installation_id')
      .eq('id', workspace_id)
      .single();

    if (wsError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    if (!workspace.github_installation_id) {
      return NextResponse.json(
        { error: 'No GitHub App installation connected to this workspace' },
        { status: 400 },
      );
    }

    if (!workspace.repo_url) {
      return NextResponse.json(
        { error: 'No repository connected to this workspace' },
        { status: 400 },
      );
    }

    // Verify installation belongs to the workspace's org
    const effectiveOrgId = orgId ?? workspace.org_id;
    if (effectiveOrgId) {
      const installation = await verifyOrgInstallation(
        supabase,
        effectiveOrgId,
        workspace.github_installation_id,
      );
      if (!installation) {
        return NextResponse.json(
          { error: 'Installation not registered for this organization' },
          { status: 400 },
        );
      }
    }

    // Extract owner/repo from repo URL
    const repoMatch = workspace.repo_url.match(/github\.com\/(.+?)(?:\.git)?$/);
    if (!repoMatch) {
      return NextResponse.json({ error: 'Invalid repo URL format' }, { status: 400 });
    }
    const repoFullName = repoMatch[1];

    // Submit the review
    const review = await submitPRReview(workspace.github_installation_id, repoFullName, pr_number, {
      event,
      body,
      comments,
    });

    // Log to activity feed
    await supabase.from('activity_log').insert({
      workspace_id,
      action: 'github_review_submitted',
      entity_type: 'workspace',
      entity_id: workspace_id,
      metadata: {
        pr_number,
        review_id: review.id,
        review_state: review.state,
        review_url: review.html_url,
        event,
        comment_count: comments?.length ?? 0,
      },
    });

    return NextResponse.json({
      ok: true,
      review_id: review.id,
      review_url: review.html_url,
      state: review.state,
    });
  } catch (error) {
    console.error('[github-reviews] Error submitting review:', error);
    return safeErrorResponse(error);
  }
}
