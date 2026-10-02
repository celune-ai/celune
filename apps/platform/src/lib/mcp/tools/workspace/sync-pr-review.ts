import { z } from 'zod';
import type { McpToolHandler, McpToolResult } from '../../types';
import { textResult, errorResult } from '../../types';
import {
  workspaceOverrideSchema,
  resolveWorkspace,
  isResolveError,
} from '../../workspace-resolver';

const schema = z.object({
  ...workspaceOverrideSchema,
  pr_number: z.number().describe('Pull request number'),
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  resolutions: z
    .array(
      z.object({
        comment_id: z.number().describe('GitHub comment ID to resolve'),
        status: z
          .enum(['fixed', 'acknowledged', 'deferred', 'wont_fix'])
          .describe('Resolution status'),
        reply: z.string().describe('Reply message explaining the resolution'),
        commit_sha: z.string().optional().describe('Commit SHA that fixed the issue'),
      }),
    )
    .optional()
    .describe(
      'Explicit resolutions for specific comments. If omitted, syncs all comments from linked tasks.',
    ),
});

/**
 * Resolution rules:
 *
 * RESOLVE the thread when:
 *   - status is 'fixed' (code was changed to address the finding)
 *   - status is 'acknowledged' (finding is noise, false positive, or intentional)
 *   - status is 'wont_fix' (decision not to address, with explanation)
 *
 * DO NOT resolve when:
 *   - status is 'deferred' (task created for follow-up, not yet done)
 *   - The reply contains an open question (ends with '?')
 *   - The finding is critical severity and not fixed
 */
function shouldResolve(status: string, reply: string, originalBody: string): boolean {
  // Never resolve deferred items
  if (status === 'deferred') return false;

  // Never resolve if the reply contains an open question
  if (reply.trim().endsWith('?')) return false;

  // Never resolve critical findings unless fixed
  if (originalBody.toLowerCase().includes('severity:** critical') && status !== 'fixed') {
    return false;
  }

  // Resolve for fixed, acknowledged, wont_fix
  return ['fixed', 'acknowledged', 'wont_fix'].includes(status);
}

export const syncPrReview: McpToolHandler = {
  name: 'sync_pr_review',
  description:
    'Reply to PR review comments with resolution status and resolve GitHub threads. ' +
    'Resolves conversations for fixed/acknowledged findings. Keeps deferred/open-question threads unresolved for tracking.',
  schema,
  scope: 'write',
  group: 'workspace',
  async execute(params, { auth, supabase }): Promise<McpToolResult> {
    const resolved = await resolveWorkspace(params, auth, supabase);
    if (isResolveError(resolved)) return resolved;

    const { pr_number, owner, repo, resolutions } = schema.parse(params);

    try {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('github_installation_id')
        .eq('id', resolved.workspaceId)
        .single();

      const rawInstallationId = ws?.github_installation_id;
      if (typeof rawInstallationId !== 'number' || !rawInstallationId) {
        return errorResult('GitHub is not connected to this workspace.');
      }
      const installationId = rawInstallationId;

      const { listReviewComments, replyToReviewComment, resolveReviewThread, getReviewThreads } =
        await import('../../../../lib/github-pr-review');

      // Fetch both REST comments (for body/IDs) and GraphQL threads (for resolution)
      const [comments, threads] = await Promise.all([
        listReviewComments({ installationId, owner, repo, prNumber: pr_number }),
        getReviewThreads({ installationId, owner, repo, prNumber: pr_number }),
      ]);

      // Build a map from comment database ID to thread ID for resolution
      const threadByCommentId = new Map(
        threads.filter((t) => !t.isResolved).map((t) => [t.commentDatabaseId, t.threadId]),
      );

      let repliedCount = 0;
      let resolvedCount = 0;
      let deferredCount = 0;

      if (resolutions && resolutions.length > 0) {
        // ── Mode 1: Explicit resolutions ──
        for (const res of resolutions) {
          const comment = comments.find((c: { id: number }) => c.id === res.comment_id);
          if (!comment) continue;

          const statusEmoji =
            res.status === 'fixed'
              ? '✅'
              : res.status === 'acknowledged'
                ? '👍'
                : res.status === 'deferred'
                  ? '📋'
                  : '⏭️';

          const commitRef = res.commit_sha ? ` (${res.commit_sha.slice(0, 7)})` : '';
          const replyBody = `${statusEmoji} **${res.status.replace('_', ' ')}**${commitRef}: ${res.reply}`;

          // Reply to the comment
          try {
            await replyToReviewComment({
              installationId,
              owner,
              repo,
              prNumber: pr_number,
              commentId: res.comment_id,
              agent: 'rick',
              body: replyBody,
              workspaceId: resolved.workspaceId,
            });
            repliedCount++;
          } catch (replyErr) {
            console.warn('[sync-pr-review] Reply failed for comment', res.comment_id, replyErr);
          }

          // Resolve the thread based on rules
          const originalBody = (comment as { body?: string }).body ?? '';
          if (shouldResolve(res.status, res.reply, originalBody)) {
            const threadId = threadByCommentId.get(res.comment_id);
            if (threadId) {
              const ok = await resolveReviewThread({ installationId, threadId });
              if (ok) resolvedCount++;
            }
          } else if (res.status === 'deferred') {
            deferredCount++;
          }
        }
      } else {
        // ── Mode 2: Auto-sync from linked tasks ──
        const { data: tasks } = await supabase
          .from('tasks')
          .select('id, title, status, outcome, metadata')
          .eq('workspace_id', resolved.workspaceId)
          .filter('metadata->>pr_number', 'eq', String(pr_number));

        const linkedTasks = tasks ?? [];

        for (const task of linkedTasks) {
          const taskMeta = (task.metadata ?? {}) as Record<string, unknown>;
          const commentId = taskMeta.pr_comment_id as number | undefined;
          if (!commentId) continue;

          const comment = comments.find((c: { id: number }) => c.id === commentId);
          if (!comment) continue;

          const isDone = task.status === 'done';
          const statusEmoji = isDone ? '✅' : task.status === 'in_progress' ? '⏳' : '📋';
          const statusLabel = isDone
            ? `Fixed${task.outcome ? ` — ${task.outcome.slice(0, 80)}` : ''}`
            : task.status === 'in_progress'
              ? 'In progress'
              : 'Deferred to inbox';

          try {
            await replyToReviewComment({
              installationId,
              owner,
              repo,
              prNumber: pr_number,
              commentId,
              agent: 'rick',
              body: `${statusEmoji} **${statusLabel}**`,
              workspaceId: resolved.workspaceId,
            });
            repliedCount++;
          } catch {
            // Continue
          }

          // Resolve thread if task is done
          if (isDone) {
            const threadId = threadByCommentId.get(commentId);
            if (threadId) {
              const ok = await resolveReviewThread({ installationId, threadId });
              if (ok) resolvedCount++;
            }
          } else {
            deferredCount++;
          }
        }
      }

      return textResult(
        `PR review sync for ${owner}/${repo}#${pr_number}: ` +
          `${repliedCount} replied, ${resolvedCount} resolved, ${deferredCount} deferred (kept open).`,
      );
    } catch (err) {
      return errorResult(`Failed to sync PR review: ${(err as Error).message}`);
    }
  },
};
