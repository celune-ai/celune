/**
 * GitHub ↔ Celune bidirectional sync.
 *
 * - GitHub → Celune: PR review comments become Celune tasks
 * - Celune → GitHub: Task completion posts replies to PR comments
 */

import { createServiceClient } from '@repo/db/service';
import { replyToPRComment, listPRReviewComments } from './github-git';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewFinding {
  comment_id: number;
  body: string;
  path: string;
  line: number | null;
  html_url: string;
  reviewer: string;
  pr_url: string;
  pr_number: number;
}

export interface SyncResult {
  tasks_created: number;
  tasks_skipped: number;
  findings: ReviewFinding[];
}

// ---------------------------------------------------------------------------
// GitHub → Celune: Review comments → tasks
// ---------------------------------------------------------------------------

/** Heuristic: is this comment actionable (a finding) vs praise/question? */
function isActionableComment(body: string): boolean {
  const lower = body.toLowerCase();

  // Skip non-actionable patterns
  const skipPatterns = [
    /^(lgtm|looks good|nice|great|awesome|\+1|👍|🎉)/i,
    /^(nit:?\s*$)/i, // bare "nit" with no content
    /^\s*$/,
  ];
  if (skipPatterns.some((p) => p.test(lower))) return false;

  // Likely actionable if it contains suggestion/fix language
  const actionPatterns = [
    /should|could|consider|instead|fix|bug|issue|missing|wrong|error|todo|hack|refactor|rename|move|extract|remove|delete|add|change|update|replace|avoid|don't|unsafe|insecure|vulnerability|xss|injection|sql|leak/i,
    /nit:/i, // "nit: something" is actionable (has content after colon)
  ];
  // Default: treat as actionable if it's substantive (>20 chars)
  return actionPatterns.some((p) => p.test(body)) || body.trim().length > 20;
}

/** Truncate to max chars, respecting word boundaries */
function truncateTitle(text: string, maxLen: number = 70): string {
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 3).replace(/\s+\S*$/, '') + '...';
}

/**
 * Process PR review comments and create Celune tasks for actionable findings.
 *
 * Called from the webhook handler when a pull_request_review event fires,
 * or manually after SCAN completes a review.
 */
export async function syncReviewCommentsToTasks(
  installationId: number,
  repoFullName: string,
  prNumber: number,
  prUrl: string,
  projectId: string | null,
  workspaceId: string,
  orgId: string,
  userId: string,
): Promise<SyncResult> {
  const comments = await listPRReviewComments(installationId, repoFullName, prNumber);

  // Service client: creates tasks from review findings. Accesses: tasks.
  const supabase = createServiceClient();
  const findings: ReviewFinding[] = [];
  let created = 0;
  let skipped = 0;

  // Batch dedup: fetch all existing review finding tasks for this PR in one query
  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('metadata')
    .eq('workspace_id', workspaceId)
    .contains('metadata', { pr_number: prNumber, review_finding: true });

  const existingCommentIds = new Set<number>(
    (existingTasks ?? [])
      .map((t) => (t.metadata as Record<string, unknown>)?.pr_comment_id as number)
      .filter((id): id is number => typeof id === 'number'),
  );

  for (const comment of comments) {
    if (!isActionableComment(comment.body)) {
      skipped++;
      continue;
    }

    // Skip comments that already have a corresponding task
    if (existingCommentIds.has(comment.id)) {
      skipped++;
      continue;
    }

    const finding: ReviewFinding = {
      comment_id: comment.id,
      body: comment.body,
      path: comment.path,
      line: comment.line,
      html_url: comment.html_url,
      reviewer: comment.user,
      pr_url: prUrl,
      pr_number: prNumber,
    };
    findings.push(finding);

    const title = truncateTitle(`Fix: ${comment.body}`);
    const description = [
      '## What',
      `Fix review finding from PR #${prNumber}.`,
      '',
      '## Finding',
      comment.body,
      '',
      `**File:** \`${comment.path}\`${comment.line ? ` (line ${comment.line})` : ''}`,
      `**Reviewer:** ${comment.user}`,
      `**PR Comment:** [View on GitHub](${comment.html_url})`,
      `**PR:** [#${prNumber}](${prUrl})`,
    ].join('\n');

    const { error: insertError } = await supabase.from('tasks').insert({
      title,
      description,
      status: 'inbox',
      priority: 'normal',
      project_id: projectId,
      workspace_id: workspaceId,
      org_id: orgId,
      user_id: userId,
      metadata: {
        pr_url: prUrl,
        pr_number: prNumber,
        pr_comment_id: comment.id,
        review_finding: true,
        file_path: comment.path,
        line: comment.line,
      },
    });

    if (insertError) {
      console.error('[github-sync] Failed to create task for comment', comment.id, insertError);
      skipped++;
    } else {
      created++;
    }
  }

  return { tasks_created: created, tasks_skipped: skipped, findings };
}

// ---------------------------------------------------------------------------
// Celune → GitHub: Task completion → PR comment reply
// ---------------------------------------------------------------------------

/**
 * When a fix task (created from a review comment) is completed,
 * post a reply on the original PR comment noting the fix.
 */
export async function notifyFixOnGitHub(
  installationId: number,
  repoFullName: string,
  prNumber: number,
  commentId: number,
  commitSha: string | null,
  taskTitle: string,
): Promise<void> {
  const body = commitSha
    ? `Fixed in [\`${commitSha.slice(0, 7)}\`](https://github.com/${repoFullName}/commit/${commitSha}) — ${taskTitle}`
    : `Fixed — ${taskTitle}`;

  await replyToPRComment(installationId, repoFullName, prNumber, commentId, body);
}

/**
 * Check if all review finding tasks for a PR are done.
 * Returns true if all findings are resolved.
 */
export async function areAllFindingsResolved(
  workspaceId: string,
  prNumber: number,
): Promise<boolean> {
  // Service client: reads task statuses. Accesses: tasks.
  const supabase = createServiceClient();

  const { data: findingTasks } = await supabase
    .from('tasks')
    .select('id, status')
    .eq('workspace_id', workspaceId)
    .contains('metadata', { pr_number: prNumber, review_finding: true });

  if (!findingTasks || findingTasks.length === 0) return true;
  return findingTasks.every((t) => t.status === 'done');
}
