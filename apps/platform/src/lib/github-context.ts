/**
 * GitHub context resolution for conversations and skills.
 *
 * Resolves the full chain: git branch → project → PR → workspace.
 * Used by /build, /git-push, and other skills to auto-detect context.
 *
 * Client-side: reads from state files written by the admin app.
 * Server-side: queries project_prs table for branch→project resolution.
 */

import type { GitHubSettings, BranchNamingConfig } from '@repo/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationContext {
  workspace_id: string;
  workspace_name: string;
  project_id: string | null;
  project_name: string | null;
  branch: string | null;
  pr_number: number | null;
  pr_status: string | null;
  pr_url: string | null;
  ci_status: string | null;
  review_state: string | null;
  tasks_remaining: number | null;
  updated_at: string;
}

export interface ContextSummary {
  line: string; // One-line confirmation for display
  context: ConversationContext;
  has_project: boolean;
  has_pr: boolean;
}

// ---------------------------------------------------------------------------
// State file paths (for CLI/skill usage)
// ---------------------------------------------------------------------------

export const STATE_DIR = '~/.claude/state';
export const ACTIVE_WORKSPACE_PATH = `${STATE_DIR}/active-workspace.json`;
export const ACTIVE_CONTEXT_PATH = `${STATE_DIR}/active-context.json`;

// ---------------------------------------------------------------------------
// Branch name utilities
// ---------------------------------------------------------------------------

/**
 * Generate a branch name from settings + project/task info.
 */
export function generateBranchName(
  config: BranchNamingConfig,
  assignee: string,
  slug: string,
): string {
  const parts = [config.prefix];
  if (config.include_assignee) parts.push(assignee);
  parts.push(slugifyForBranch(slug));
  return parts.join(config.separator);
}

/**
 * Parse a branch name to extract prefix, assignee, and slug.
 * Returns null if the branch doesn't match the naming convention.
 */
export function parseBranchName(
  branchName: string,
  config: BranchNamingConfig,
): { prefix: string; assignee: string | null; slug: string } | null {
  const sep = escapeRegex(config.separator);
  const pattern = config.include_assignee
    ? new RegExp(`^(${sep === '/' ? '[^/]+' : `[^${sep}]+`})${sep}([^${sep}]+)${sep}(.+)$`)
    : new RegExp(`^(${sep === '/' ? '[^/]+' : `[^${sep}]+`})${sep}(.+)$`);

  const match = branchName.match(pattern);
  if (!match) return null;

  if (config.include_assignee) {
    return { prefix: match[1], assignee: match[2], slug: match[3] };
  }
  return { prefix: match[1], assignee: null, slug: match[2] };
}

function slugifyForBranch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format a conversation context into a one-line summary.
 */
export function formatContextLine(ctx: ConversationContext): ContextSummary {
  if (!ctx.project_name) {
    return {
      line: `On branch ${ctx.branch} — no linked project. Use /build to create one.`,
      context: ctx,
      has_project: false,
      has_pr: false,
    };
  }

  const parts: string[] = [`Working on **${ctx.project_name}**`];

  if (ctx.pr_number) {
    const statusEmoji =
      ctx.pr_status === 'merged'
        ? '(merged)'
        : ctx.pr_status === 'draft'
          ? '(draft)'
          : ctx.pr_status === 'closed'
            ? '(closed)'
            : '';
    parts.push(`PR #${ctx.pr_number} ${statusEmoji}`.trim());

    if (ctx.ci_status) {
      const ciIcon =
        ctx.ci_status === 'passing'
          ? 'CI passing'
          : ctx.ci_status === 'failing'
            ? 'CI failing'
            : 'CI pending';
      parts.push(ciIcon);
    }
  }

  if (ctx.tasks_remaining !== null && ctx.tasks_remaining > 0) {
    parts.push(`${ctx.tasks_remaining} tasks remaining`);
  }

  return {
    line: parts.join('. ') + '.',
    context: ctx,
    has_project: true,
    has_pr: !!ctx.pr_number,
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_GITHUB_SETTINGS: GitHubSettings = {
  pr_strategy: 'per_project',
  auto_pr: 'draft_on_push',
  branch_naming: {
    prefix: 'celune',
    separator: '/',
    include_assignee: true,
    slug_source: 'project_name',
  },
  default_reviewers: [],
  rebase_threshold_commits: 20,
  stale_pr_warning_days: 7,
  agent_code_context: true,
  auto_sync_on_push: true,
  webhook_events: false,
};
