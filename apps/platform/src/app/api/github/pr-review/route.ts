/**
 * GitHub PR Review — agent collaboration endpoint.
 *
 * POST /api/github/pr-review?workspace_id=<id>
 *
 * Agents call this to post review findings, reply to comments,
 * edit comments, and list review comments on a PR.
 * All comments appear as `celune[bot]` via the GitHub App installation.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { validateOrigin } from '@/lib/csrf';
import { z } from 'zod';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import {
  createAgentReview,
  postPrComment,
  replyToReviewComment,
  editPrComment,
  listReviewComments,
} from '@/lib/github-pr-review';

export const dynamic = 'force-dynamic';

const postReviewSchema = z
  .object({
    action: z.enum(['create_review', 'reply', 'comment', 'edit_comment', 'list_comments']),
    owner: z.string(),
    repo: z.string(),
    pr_number: z.number(),
    agent: z.string().optional(),
    // For create_review
    findings: z
      .array(
        z.object({
          path: z.string(),
          line: z.number(),
          body: z.string(),
          severity: z.enum(['critical', 'high', 'medium', 'low']),
        }),
      )
      .optional(),
    summary: z.string().optional(),
    approve: z.boolean().optional(),
    // For reply / edit_comment
    comment_id: z.number().optional(),
    body: z.string().optional(),
  })
  .strip();

export async function POST(request: NextRequest) {
  const rl = await applyRateLimit(request, 'github.pr-review.post', RATE_WRITE);
  if (rl) return rl.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const wsResult = extractRequiredWorkspaceId(request);
  if (wsResult instanceof NextResponse) return wsResult;
  const workspaceId = wsResult;

  const userId = getAuthUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const permResult = await requirePermission(request, workspaceId, 'settings:read');
  if (permResult instanceof NextResponse) return permResult;

  const parsed = await parseBody(request, postReviewSchema);
  if (isErrorResponse(parsed)) return parsed;

  // Resolve GitHub installation ID from workspace
  const supabase = createServiceClient();
  const { data: ws } = await supabase
    .from('workspaces')
    .select('metadata, github_installation_id')
    .eq('id', workspaceId)
    .single();

  const installationId = ws?.github_installation_id as number | null;
  if (!installationId) {
    return NextResponse.json({ error: 'GitHub not connected to this workspace' }, { status: 400 });
  }

  // Check PR review settings from workspace metadata
  const meta = (ws?.metadata as Record<string, unknown>) ?? {};
  const settings = (meta.github_review_settings as Record<string, boolean>) ?? {};

  const { action, owner, repo, pr_number, agent } = parsed;

  // Check settings gates
  if (action === 'create_review' && settings.agent_code_review === false) {
    return NextResponse.json({ skipped: true, reason: 'agent_code_review disabled in settings' });
  }
  if (action === 'comment' && settings.pr_summary_comments === false) {
    return NextResponse.json({
      skipped: true,
      reason: 'pr_summary_comments disabled in settings',
    });
  }

  try {
    switch (action) {
      case 'create_review': {
        const result = await createAgentReview({
          installationId,
          owner,
          repo,
          prNumber: pr_number,
          agent: agent || 'scan',
          findings: parsed.findings || [],
          summary: parsed.summary || '',
          approve: parsed.approve || false,
          workspaceId,
        });
        return NextResponse.json(result);
      }
      case 'reply': {
        if (!parsed.comment_id || !parsed.body) {
          return NextResponse.json(
            { error: 'comment_id and body required for reply' },
            { status: 400 },
          );
        }
        const result = await replyToReviewComment({
          installationId,
          owner,
          repo,
          prNumber: pr_number,
          commentId: parsed.comment_id,
          agent: agent || 'rick',
          body: parsed.body,
          workspaceId,
        });
        return NextResponse.json(result);
      }
      case 'comment': {
        if (!parsed.body) {
          return NextResponse.json({ error: 'body required for comment' }, { status: 400 });
        }
        const result = await postPrComment({
          installationId,
          owner,
          repo,
          prNumber: pr_number,
          agent: agent || 'sage',
          body: parsed.body,
          workspaceId,
        });
        return NextResponse.json(result);
      }
      case 'edit_comment': {
        if (!parsed.comment_id || !parsed.body) {
          return NextResponse.json({ error: 'comment_id and body required' }, { status: 400 });
        }
        await editPrComment({
          installationId,
          owner,
          repo,
          commentId: parsed.comment_id,
          body: parsed.body,
        });
        return NextResponse.json({ success: true });
      }
      case 'list_comments': {
        const comments = await listReviewComments({
          installationId,
          owner,
          repo,
          prNumber: pr_number,
        });
        return NextResponse.json({ comments });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    console.error('[pr-review]', (err as Error).message);
    return NextResponse.json({ error: 'GitHub API error' }, { status: 502 });
  }
}
