/**
 * GitHub PR Review API helpers.
 *
 * Wraps GitHub's PR review API using the existing GitHub App integration.
 * All comments appear as `celune[bot]`.
 */

import { createInstallationOctokit } from './github-app';
import { createServiceClient } from '@repo/db/service';

/**
 * Retry with exponential backoff for GitHub API secondary rate limits.
 * GitHub returns 403 with "secondary rate limit" or 429 when hitting abuse limits.
 */
async function withGitHubRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const message = (err as { message?: string }).message ?? '';
      const isRateLimit = status === 429 || (status === 403 && message.includes('rate limit'));
      if (!isRateLimit || attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

// Fallback emoji prefixes (used when agent_configs not available)
const DEFAULT_AGENT_EMOJI: Record<string, string> = {
  scan: '\u{1F50D}',
  noir: '\u{1F3A8}',
  rick: '\u{1F527}',
  sage: '\u{1F4DD}',
};

/**
 * Resolve agent display name from workspace agent_configs.
 * Falls back to uppercase agent ID if not found.
 */
export async function resolveAgentPrefix(agentId: string, workspaceId?: string): Promise<string> {
  const emoji = DEFAULT_AGENT_EMOJI[agentId] ?? '\u{1F916}';
  if (!workspaceId) return `${emoji} **${agentId.toUpperCase()}**`;

  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('agent_configs')
      .select('display_name')
      .eq('workspace_id', workspaceId)
      .eq('agent_id', agentId)
      .maybeSingle();
    const name = data?.display_name || agentId.toUpperCase();
    return `${emoji} **${name}**`;
  } catch {
    return `${emoji} **${agentId.toUpperCase()}**`;
  }
}

/**
 * Log a PR review interaction to activity_log as agent.message.
 * This makes it visible in the Celune Messages tab.
 */
async function logReviewMessage(opts: {
  workspaceId?: string;
  agentId: string;
  agentName: string;
  toAgent?: string;
  content: string;
  prNumber: number;
  repo: string;
  commentId?: number;
  taskId?: string;
}) {
  if (!opts.workspaceId) return;
  try {
    const supabase = createServiceClient();
    await supabase.from('activity_log').insert({
      event_type: 'agent.message',
      severity: 'info',
      source: 'github-pr-review',
      title: `${opts.agentName} commented on PR #${opts.prNumber}`,
      agent_id: opts.agentId,
      workspace_id: opts.workspaceId,
      task_id: opts.taskId ?? null,
      details: {
        agent_name: opts.agentName,
        to_agent: opts.toAgent ?? null,
        message: opts.content,
        pr_number: opts.prNumber,
        repo: opts.repo,
        github_comment_id: opts.commentId ?? null,
        thread_title: `PR #${opts.prNumber} Review — ${opts.repo}`,
      },
    });
  } catch {
    // Non-blocking — message logging is supplementary
  }
}

export interface ReviewFinding {
  path: string;
  line: number;
  body: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface CreateReviewOpts {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  agent: string;
  findings: ReviewFinding[];
  summary: string;
  approve: boolean;
  workspaceId?: string;
}

/** Create a PR review with line-level comments. */
export async function createAgentReview(opts: CreateReviewOpts) {
  const octokit = await createInstallationOctokit(opts.installationId);
  const prefix = await resolveAgentPrefix(opts.agent, opts.workspaceId);

  const comments = opts.findings.map((f) => ({
    path: f.path,
    line: f.line,
    body: `${prefix}: ${f.body}\n\n**Severity:** ${f.severity}`,
  }));

  const event = opts.approve
    ? ('APPROVE' as const)
    : opts.findings.some((f) => f.severity === 'critical' || f.severity === 'high')
      ? ('REQUEST_CHANGES' as const)
      : ('COMMENT' as const);

  const { data } = await withGitHubRetry(() =>
    octokit.pulls.createReview({
      owner: opts.owner,
      repo: opts.repo,
      pull_number: opts.prNumber,
      body: `${prefix}: ${opts.summary}`,
      event,
      comments,
    }),
  );

  // Skip fetching comment IDs to stay within serverless timeout.
  // Task status is shown in the SAGE summary comment instead of threaded replies.
  const commentIds: number[] = [];

  // Log to Messages tab
  await logReviewMessage({
    workspaceId: opts.workspaceId,
    agentId: opts.agent,
    agentName: prefix.replace(/[*]/g, '').trim(),
    content: opts.summary,
    prNumber: opts.prNumber,
    repo: `${opts.owner}/${opts.repo}`,
  });

  return { reviewId: data.id, commentIds };
}

/** Reply to a specific review comment (threaded). */
export async function replyToReviewComment(opts: {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  commentId: number;
  agent: string;
  body: string;
  workspaceId?: string;
  toAgent?: string;
}) {
  const octokit = await createInstallationOctokit(opts.installationId);
  const prefix = await resolveAgentPrefix(opts.agent, opts.workspaceId);

  const { data } = await withGitHubRetry(() =>
    octokit.pulls.createReplyForReviewComment({
      owner: opts.owner,
      repo: opts.repo,
      pull_number: opts.prNumber,
      comment_id: opts.commentId,
      body: `${prefix}: ${opts.body}`,
    }),
  );

  await logReviewMessage({
    workspaceId: opts.workspaceId,
    agentId: opts.agent,
    agentName: prefix.replace(/[*]/g, '').trim(),
    toAgent: opts.toAgent,
    content: opts.body,
    prNumber: opts.prNumber,
    repo: `${opts.owner}/${opts.repo}`,
    commentId: data.id,
  });

  return { commentId: data.id };
}

/**
 * Resolve a single PR review thread by its thread ID.
 * Use getReviewThreads() to look up thread IDs first.
 */
export async function resolveReviewThread(opts: { installationId: number; threadId: string }) {
  try {
    const octokit = await createInstallationOctokit(opts.installationId);
    await octokit.graphql(
      `mutation($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
          thread { isResolved }
        }
      }`,
      { threadId: opts.threadId },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all review threads for a PR, mapped to their first comment's database ID.
 * Used to look up thread IDs for resolving conversations.
 */
export async function getReviewThreads(opts: {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
}): Promise<Array<{ threadId: string; isResolved: boolean; commentDatabaseId: number }>> {
  try {
    const octokit = await createInstallationOctokit(opts.installationId);
    const result = await octokit.graphql<{
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: Array<{
              id: string;
              isResolved: boolean;
              comments: { nodes: Array<{ databaseId: number }> };
            }>;
          };
        };
      };
    }>(
      `query($owner: String!, $repo: String!, $pr: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 1) {
                  nodes { databaseId }
                }
              }
            }
          }
        }
      }`,
      { owner: opts.owner, repo: opts.repo, pr: opts.prNumber },
    );

    return result.repository.pullRequest.reviewThreads.nodes.map((t) => ({
      threadId: t.id,
      isResolved: t.isResolved,
      commentDatabaseId: t.comments.nodes[0]?.databaseId ?? 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Submit an approval review on a PR (after all critical/high issues resolved).
 */
export async function submitApproval(opts: {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  workspaceId?: string;
}) {
  const octokit = await createInstallationOctokit(opts.installationId);
  const prefix = await resolveAgentPrefix('sage', opts.workspaceId);

  await withGitHubRetry(() =>
    octokit.pulls.createReview({
      owner: opts.owner,
      repo: opts.repo,
      pull_number: opts.prNumber,
      body: `${prefix}: ${opts.body}`,
      event: 'APPROVE',
    }),
  );
}

/** Post a top-level PR comment (not a review — for retro summaries). */
export async function postPrComment(opts: {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  agent: string;
  body: string;
  workspaceId?: string;
}) {
  const octokit = await createInstallationOctokit(opts.installationId);
  const prefix = await resolveAgentPrefix(opts.agent, opts.workspaceId);

  const { data } = await withGitHubRetry(() =>
    octokit.issues.createComment({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: opts.prNumber,
      body: `${prefix}: ${opts.body}`,
    }),
  );

  await logReviewMessage({
    workspaceId: opts.workspaceId,
    agentId: opts.agent,
    agentName: prefix.replace(/[*]/g, '').trim(),
    content: opts.body,
    prNumber: opts.prNumber,
    repo: `${opts.owner}/${opts.repo}`,
    commentId: data.id,
  });

  return { commentId: data.id };
}

/** Edit an existing PR comment (for live status updates). */
export async function editPrComment(opts: {
  installationId: number;
  owner: string;
  repo: string;
  commentId: number;
  body: string;
}) {
  const octokit = await createInstallationOctokit(opts.installationId);

  await withGitHubRetry(() =>
    octokit.issues.updateComment({
      owner: opts.owner,
      repo: opts.repo,
      comment_id: opts.commentId,
      body: opts.body,
    }),
  );
}

/** List all review comments on a PR (for agents to read each other's findings). */
export async function listReviewComments(opts: {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
}) {
  const octokit = await createInstallationOctokit(opts.installationId);

  const { data } = await withGitHubRetry(() =>
    octokit.pulls.listReviewComments({
      owner: opts.owner,
      repo: opts.repo,
      pull_number: opts.prNumber,
      per_page: 100,
    }),
  );

  return data;
}
