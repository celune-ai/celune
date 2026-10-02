/**
 * GitHub App webhook receiver.
 *
 * Receives push, pull_request, pull_request_review, and create events
 * from connected repositories. Verifies the webhook signature, then
 * dispatches to the appropriate handler.
 *
 * POST /api/github/webhooks
 */

import { type NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { syncReviewCommentsToTasks } from '@/lib/github-sync';
import { registerOrgInstallation } from '@/lib/github-org';
import { createAppOctokit, isGitHubAppConfigured } from '@/lib/github-app';
import { triggerAgentPrReview } from '@/lib/pr-auto-review';
import { dispatchNotification } from '@repo/notifications';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds — review pipeline needs time for Claude calls

// ---------------------------------------------------------------------------
// In-memory rate limiting (per serverless instance)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // max requests per window per IP

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
let rateLimitRequestCount = 0;

function isRateLimited(request: NextRequest): boolean {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const now = Date.now();

  // Periodic cleanup: every 100 requests, purge stale entries
  rateLimitRequestCount++;
  if (rateLimitRequestCount % 100 === 0) {
    for (const [key, entry] of rateLimitMap) {
      if (entry.resetAt <= now) {
        rateLimitMap.delete(key);
      }
    }
  }

  const entry = rateLimitMap.get(ip);

  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifyWebhookSignature(payload: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[github-webhook] GITHUB_APP_WEBHOOK_SECRET is not set — rejecting request');
    return false;
  }
  if (!signature) return false;

  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handlePush(payload: Record<string, unknown>) {
  const repoFullName = (payload.repository as Record<string, unknown>)?.full_name as string;
  if (!repoFullName) return;

  // Service client: updates workspace last_synced. Accesses: workspaces.
  const supabase = createServiceClient();

  // Find workspaces connected to this repo
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('repo_url', `https://github.com/${repoFullName}`);

  if (!workspaces?.length) return;

  const now = new Date().toISOString();
  const ref = payload.ref as string;
  const headCommit = payload.head_commit as Record<string, unknown> | null;

  for (const ws of workspaces) {
    // Update last synced timestamp
    await supabase.from('workspaces').update({ updated_at: now }).eq('id', ws.id);

    // Log to activity feed
    await supabase.from('activity_log').insert({
      workspace_id: ws.id,
      action: 'github_push',
      entity_type: 'workspace',
      entity_id: ws.id,
      metadata: {
        repo: repoFullName,
        ref,
        commit_sha: headCommit?.id ?? null,
        commit_message: headCommit?.message ?? null,
        pusher: (payload.pusher as Record<string, unknown>)?.name ?? null,
      },
    });
  }
}

async function handleReviewRequested(payload: Record<string, unknown>) {
  const pr = payload.pull_request as Record<string, unknown>;
  const requestedReviewer = payload.requested_reviewer as Record<string, unknown> | undefined;
  const repoFullName = (payload.repository as Record<string, unknown>)?.full_name as string;
  if (!pr || !repoFullName || !requestedReviewer) return;

  const reviewerLogin = requestedReviewer.login as string;

  const supabase = createServiceClient();
  const prNumber = pr.number as number;
  const prUrl = pr.html_url as string;
  const headBranch = (pr.head as Record<string, unknown>)?.ref as string;

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('repo_url', `https://github.com/${repoFullName}`);

  if (!workspaces?.length) return;

  for (const ws of workspaces) {
    // Find linked project via project_prs or branch metadata
    const { data: linkedPr } = await supabase
      .from('project_prs')
      .select('project_id')
      .eq('workspace_id', ws.id)
      .eq('pr_number', prNumber)
      .maybeSingle();

    let projectId = linkedPr?.project_id ?? null;

    if (!projectId) {
      // Try matching by branch name in project metadata
      const { data: projects } = await supabase
        .from('projects')
        .select('id')
        .eq('workspace_id', ws.id)
        .contains('metadata', { branch: headBranch });
      projectId = projects?.[0]?.id ?? null;
    }

    // Log the QA review request
    await supabase.from('activity_log').insert({
      workspace_id: ws.id,
      action: 'git_review_requested',
      entity_type: 'workspace',
      entity_id: ws.id,
      metadata: {
        repo: repoFullName,
        pr_number: prNumber,
        pr_url: prUrl,
        project_id: projectId,
        reviewer: reviewerLogin,
        trigger: 'webhook',
      },
    });

    // Dispatch review.requested notification (best-effort)
    dispatchNotification({
      type: 'review.requested',
      workspaceId: ws.id,
      payload: {
        pr_number: prNumber,
        pr_url: prUrl,
        reviewer: reviewerLogin,
        project_id: projectId,
      },
    }).catch(() => {});

    console.info(
      `[github-webhook] QA review requested on PR #${prNumber}` +
        (projectId ? ` (project: ${projectId})` : ' (no linked project)'),
    );
  }
}

async function handlePullRequest(payload: Record<string, unknown>) {
  const action = payload.action as string;
  const pr = payload.pull_request as Record<string, unknown>;
  const repoFullName = (payload.repository as Record<string, unknown>)?.full_name as string;
  if (!pr || !repoFullName) return;

  // Handle review_requested action separately
  if (action === 'review_requested') {
    await handleReviewRequested(payload);
    return;
  }

  // Service client: reads/writes workspaces, tasks, activity_log, project_prs.
  const supabase = createServiceClient();

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, github_installation_id, metadata')
    .eq('repo_url', `https://github.com/${repoFullName}`);

  if (!workspaces?.length) return;

  const prNumber = pr.number as number;
  const prTitle = pr.title as string;
  const prUrl = pr.html_url as string;
  const headBranch = (pr.head as Record<string, unknown>)?.ref as string;
  const baseBranch = (pr.base as Record<string, unknown>)?.ref as string;
  const headSha = (pr.head as Record<string, unknown>)?.sha as string;
  const merged = pr.merged as boolean;
  const draft = pr.draft as boolean;
  const additions = pr.additions as number | undefined;
  const deletions = pr.deletions as number | undefined;

  // Determine PR status for project_prs
  let prStatus: string;
  if (action === 'closed' && merged) prStatus = 'merged';
  else if (action === 'closed') prStatus = 'closed';
  else if (draft) prStatus = 'draft';
  else prStatus = 'open';

  for (const ws of workspaces) {
    // ── Sync to project_prs table ──
    // Find existing record or match by branch name to a project
    const { data: existingPr } = await supabase
      .from('project_prs')
      .select('id, project_id')
      .eq('workspace_id', ws.id)
      .eq('pr_number', prNumber)
      .maybeSingle();

    if (existingPr) {
      // Update existing record
      const updates: Record<string, unknown> = {
        status: prStatus,
        title: prTitle,
        head_sha: headSha,
        base_branch: baseBranch,
      };
      if (additions !== undefined) updates.additions = additions;
      if (deletions !== undefined) updates.deletions = deletions;
      if (prStatus === 'merged') updates.merged_at = new Date().toISOString();
      if (prStatus === 'closed') updates.closed_at = new Date().toISOString();

      await supabase.from('project_prs').update(updates).eq('id', existingPr.id);
    } else if (action === 'opened' || action === 'reopened') {
      // New PR — try to find a matching project by branch name in project metadata
      const { data: projects } = await supabase
        .from('projects')
        .select('id')
        .eq('workspace_id', ws.id)
        .contains('metadata', { branch: headBranch });

      const projectId = projects?.[0]?.id;
      if (projectId) {
        await supabase.from('project_prs').insert({
          workspace_id: ws.id,
          project_id: projectId,
          pr_number: prNumber,
          pr_url: prUrl,
          branch_name: headBranch,
          title: prTitle,
          status: prStatus,
          head_sha: headSha,
          base_branch: baseBranch,
          additions: additions ?? 0,
          deletions: deletions ?? 0,
        });
      }
    }

    // Log PR event to activity feed
    await supabase.from('activity_log').insert({
      workspace_id: ws.id,
      action: `github_pr_${action}`,
      entity_type: 'workspace',
      entity_id: ws.id,
      metadata: {
        repo: repoFullName,
        pr_number: prNumber,
        pr_title: prTitle,
        pr_url: prUrl,
        head_branch: headBranch,
        action,
        merged: merged ?? false,
      },
    });

    // ── Auto-trigger agent PR review on opened/reopened ──────────────────
    if ((action === 'opened' || action === 'reopened') && !draft) {
      const meta = (ws.metadata as Record<string, unknown>) ?? {};
      const reviewSettings = (meta.github_review_settings as Record<string, boolean>) ?? {};
      const autoReviewEnabled = reviewSettings.agent_code_review !== false; // default: on

      if (autoReviewEnabled && ws.github_installation_id) {
        const [owner, repo] = repoFullName.split('/');

        // Use after() to run review pipeline after response is sent
        // This keeps the webhook response fast (< 10s GitHub timeout)
        // while still executing the full Claude-powered review
        after(async () => {
          try {
            await triggerAgentPrReview({
              installationId: ws.github_installation_id!,
              owner: owner!,
              repo: repo!,
              prNumber,
              prTitle,
              headBranch,
              baseBranch,
              additions: additions ?? 0,
              deletions: deletions ?? 0,
              workspaceId: ws.id,
              workspaceName: ws.name,
            });
          } catch (err) {
            console.error(`[webhook/pr] Auto-review failed for PR #${prNumber}:`, err);
          }
        });
      }
    }

    // On PR merge: update linked tasks + create changelog entry
    if (action === 'closed' && merged) {
      // Complete linked tasks — query only tasks matching this PR or branch
      const { data: prLinked } = await supabase
        .from('tasks')
        .select('id')
        .eq('workspace_id', ws.id)
        .not('status', 'eq', 'done')
        .contains('metadata', { pr_url: prUrl });

      const { data: branchLinked } = await supabase
        .from('tasks')
        .select('id')
        .eq('workspace_id', ws.id)
        .not('status', 'eq', 'done')
        .contains('metadata', { branch: headBranch });

      const taskIds = new Set<string>();
      for (const t of prLinked ?? []) taskIds.add(t.id);
      for (const t of branchLinked ?? []) taskIds.add(t.id);

      for (const taskId of taskIds) {
        await supabase
          .from('tasks')
          .update({ status: 'done', updated_at: new Date().toISOString() })
          .eq('id', taskId);
      }

      // Create changelog entry from merged PR
      const prBody = (pr.body as string) ?? '';
      const labels = (pr.labels as Array<{ name: string }>) ?? [];
      const labelNames = labels.map((l) => l.name.toLowerCase());

      // Detect category from labels
      let category = 'Feature';
      if (labelNames.includes('fix') || labelNames.includes('bug')) category = 'Fix';
      else if (labelNames.includes('improvement') || labelNames.includes('enhancement'))
        category = 'System';
      else if (labelNames.includes('breaking')) category = 'Breaking Change';

      // Detect if this is a conventional commit title
      if (prTitle.startsWith('fix:') || prTitle.startsWith('fix(')) category = 'Fix';
      else if (prTitle.startsWith('refactor:') || prTitle.startsWith('chore:')) category = 'System';

      const today = new Date().toISOString().slice(0, 10);
      const slug = `${today}-pr-${prNumber}`;

      // Extract first paragraph of PR body as description
      const descriptionMatch = prBody.match(/^## Summary\n([\s\S]*?)(?=\n##|\n$)/);
      const description = descriptionMatch
        ? descriptionMatch[1]
            .replace(/^[-*]\s*/gm, '')
            .trim()
            .slice(0, 300)
        : prTitle;

      await supabase.from('changelog_entries').upsert(
        {
          slug,
          date: today,
          title: prTitle.replace(/^(feat|fix|refactor|chore|docs|test)(\(.+?\))?:\s*/i, ''),
          description,
          category,
          body: prBody || null,
          pr_number: prNumber,
          pr_url: prUrl,
          repo: repoFullName,
          auto_generated: true,
          workspace_id: ws.id,
        },
        { onConflict: 'slug' },
      );

      // ── Group branch merge handling ──
      // When a PR merges into a group branch, check if all group projects are done
      if (baseBranch.startsWith('group/')) {
        await handleGroupBranchMerge(supabase, ws.id, baseBranch, headBranch, prNumber, prUrl);
      }

      // When a group PR merges into main, update group metadata
      if (baseBranch === 'main' && headBranch.startsWith('group/')) {
        await handleGroupPrMerge(supabase, ws.id, headBranch, prNumber);
      }
    }
  }
}

/**
 * When a project PR merges into a group branch, check if all projects in the
 * group now have merged PRs. If so, log an activity event suggesting group PR creation.
 */
async function handleGroupBranchMerge(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  groupBranch: string,
  projectBranch: string,
  prNumber: number,
  prUrl: string,
) {
  // Find the project group by branch name in metadata
  const { data: groups } = await supabase
    .from('project_groups')
    .select('id, name, metadata')
    .eq('workspace_id', workspaceId)
    .contains('metadata', { branch: groupBranch });

  if (!groups?.length) return;
  const group = groups[0];
  const groupMeta = (group.metadata as Record<string, unknown>) ?? {};

  // Find all projects in this group
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, status, metadata')
    .eq('group_id', group.id);

  if (!projects?.length) return;

  // Track merged project PRs by checking project_prs table
  const { data: mergedPrs } = await supabase
    .from('project_prs')
    .select('project_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'merged')
    .eq('base_branch', groupBranch);

  const mergedProjectIds = new Set((mergedPrs ?? []).map((p) => p.project_id));
  const totalProjects = projects.length;
  const mergedCount = projects.filter((p) => mergedProjectIds.has(p.id)).length;

  // Update group metadata with merge progress
  await supabase
    .from('project_groups')
    .update({
      metadata: {
        ...groupMeta,
        merged_count: mergedCount,
        total_projects: totalProjects,
        last_merge_pr: prNumber,
        last_merge_branch: projectBranch,
      },
    })
    .eq('id', group.id);

  // Log activity
  await supabase.from('activity_log').insert({
    workspace_id: workspaceId,
    action: 'group_project_merged',
    entity_type: 'project_group',
    entity_id: group.id,
    metadata: {
      group_name: group.name,
      group_branch: groupBranch,
      project_branch: projectBranch,
      pr_number: prNumber,
      pr_url: prUrl,
      merged_count: mergedCount,
      total_projects: totalProjects,
      all_merged: mergedCount === totalProjects,
    },
  });
}

/**
 * When a group PR (group branch → main) merges, update the group metadata
 * to reflect the completed rollup.
 */
async function handleGroupPrMerge(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  groupBranch: string,
  prNumber: number,
) {
  const { data: groups } = await supabase
    .from('project_groups')
    .select('id, name, metadata')
    .eq('workspace_id', workspaceId)
    .contains('metadata', { branch: groupBranch });

  if (!groups?.length) return;
  const group = groups[0];
  const groupMeta = (group.metadata as Record<string, unknown>) ?? {};

  await supabase
    .from('project_groups')
    .update({
      metadata: {
        ...groupMeta,
        group_pr_number: prNumber,
        group_pr_status: 'merged',
        merged_to_main_at: new Date().toISOString(),
      },
    })
    .eq('id', group.id);

  // Log activity
  await supabase.from('activity_log').insert({
    workspace_id: workspaceId,
    action: 'group_pr_merged',
    entity_type: 'project_group',
    entity_id: group.id,
    metadata: {
      group_name: group.name,
      group_branch: groupBranch,
      pr_number: prNumber,
    },
  });
}

async function handlePullRequestReview(payload: Record<string, unknown>) {
  const review = payload.review as Record<string, unknown>;
  const pr = payload.pull_request as Record<string, unknown>;
  const repoFullName = (payload.repository as Record<string, unknown>)?.full_name as string;
  if (!review || !pr || !repoFullName) return;

  // Service client: reads workspaces, inserts activity_log, creates tasks from findings.
  const supabase = createServiceClient();

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, org_id, user_id, github_installation_id')
    .eq('repo_url', `https://github.com/${repoFullName}`);

  if (!workspaces?.length) return;

  const reviewState = review.state as string;
  const prNumber = pr.number as number;
  const prUrl = pr.html_url as string;
  const headBranch = (pr.head as Record<string, unknown>)?.ref as string;

  for (const ws of workspaces) {
    // ── Sync review_state to project_prs ──
    const reviewStateMap: Record<string, string> = {
      approved: 'approved',
      changes_requested: 'changes_requested',
      commented: 'commented',
      dismissed: 'dismissed',
    };
    const mappedState = reviewStateMap[reviewState];
    if (mappedState) {
      await supabase
        .from('project_prs')
        .update({ review_state: mappedState })
        .eq('workspace_id', ws.id)
        .eq('pr_number', prNumber);
    }

    // Log the review event
    await supabase.from('activity_log').insert({
      workspace_id: ws.id,
      action: 'github_pr_review',
      entity_type: 'workspace',
      entity_id: ws.id,
      metadata: {
        repo: repoFullName,
        pr_number: prNumber,
        pr_url: prUrl,
        review_state: reviewState,
        reviewer: (review.user as Record<string, unknown>)?.login ?? null,
        review_body: review.body ?? null,
      },
    });

    // Dispatch review.completed notification (best-effort)
    dispatchNotification({
      type: 'review.completed',
      workspaceId: ws.id,
      payload: {
        pr_number: prNumber,
        pr_url: prUrl,
        review_state: reviewState,
        reviewer: (review.user as Record<string, unknown>)?.login ?? null,
      },
    }).catch(() => {});

    // If review has changes requested, sync comments → tasks
    if (
      (reviewState === 'changes_requested' || reviewState === 'commented') &&
      ws.github_installation_id
    ) {
      // Find the project linked to this branch
      const { data: linkedTasks } = await supabase
        .from('tasks')
        .select('project_id')
        .eq('workspace_id', ws.id)
        .contains('metadata', { branch: headBranch })
        .limit(1);

      const projectId = linkedTasks?.[0]?.project_id ?? null;

      try {
        const result = await syncReviewCommentsToTasks(
          ws.github_installation_id,
          repoFullName,
          prNumber,
          prUrl,
          projectId,
          ws.id,
          ws.org_id,
          ws.user_id,
        );

        if (result.tasks_created > 0) {
          await supabase.from('activity_log').insert({
            workspace_id: ws.id,
            action: 'review_tasks_created',
            entity_type: 'workspace',
            entity_id: ws.id,
            metadata: {
              pr_number: prNumber,
              pr_url: prUrl,
              tasks_created: result.tasks_created,
              tasks_skipped: result.tasks_skipped,
            },
          });
        }
      } catch (err) {
        console.error('[github-webhook] Failed to sync review comments to tasks:', err);
      }
    }
  }
}

async function handleCreate(payload: Record<string, unknown>) {
  const refType = payload.ref_type as string; // 'branch' | 'tag'
  const ref = payload.ref as string;
  const repoFullName = (payload.repository as Record<string, unknown>)?.full_name as string;
  if (!repoFullName) return;

  // Service client: reads workspaces, inserts activity_log.
  const supabase = createServiceClient();

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('repo_url', `https://github.com/${repoFullName}`);

  if (!workspaces?.length) return;

  for (const ws of workspaces) {
    await supabase.from('activity_log').insert({
      workspace_id: ws.id,
      action: `github_${refType}_created`,
      entity_type: 'workspace',
      entity_id: ws.id,
      metadata: {
        repo: repoFullName,
        ref_type: refType,
        ref,
      },
    });
  }
}

async function handleInstallation(payload: Record<string, unknown>) {
  const action = payload.action as string;
  const installation = payload.installation as Record<string, unknown>;
  if (!installation) return;

  const installationId = installation.id as number;

  console.info('[webhook/installation] action:', action, 'installation:', installationId);

  // Service client: manages org_github_installations and workspaces.
  const supabase = createServiceClient();

  switch (action) {
    case 'created': {
      // The OAuth callback usually handles registration, but the webhook may
      // arrive first or the callback may have failed. Idempotently register.
      const { data: existingRows } = await supabase
        .from('org_github_installations')
        .select('id')
        .eq('installation_id', installationId)
        .limit(1);

      if (existingRows?.length) {
        console.info(
          '[webhook/installation] created — already registered in at least one org, skipping',
        );
        break;
      }

      // Try to determine the org from the webhook payload. The installation
      // account tells us who installed the app, but we need an org_id from our
      // DB. Look for an org whose github_account_login matches.
      const account = installation.account as Record<string, unknown> | undefined;
      const accountLogin = (account?.login as string) ?? null;
      const accountType = (account?.type as 'Organization' | 'User') ?? 'User';
      const accountAvatarUrl = (account?.avatar_url as string) ?? null;

      if (!accountLogin) {
        console.info(
          '[webhook/installation] created — no account login in payload, cannot auto-register',
        );
        break;
      }

      // Try to find a matching org by checking existing installations with
      // the same account login, or by matching org metadata.
      const { data: matchingOrg } = await supabase
        .from('org_github_installations')
        .select('org_id')
        .eq('github_account_login', accountLogin)
        .limit(1)
        .maybeSingle();

      if (!matchingOrg) {
        console.info(
          '[webhook/installation] created — no matching org found for account',
          accountLogin,
          '— skipping auto-register (callback will handle)',
        );
        break;
      }

      try {
        await registerOrgInstallation(
          supabase,
          matchingOrg.org_id,
          installationId,
          accountLogin,
          accountAvatarUrl,
          accountType,
          'webhook', // connected_by: webhook auto-registration
        );
        console.info(
          '[webhook/installation] created — registered installation for org',
          matchingOrg.org_id,
        );
      } catch (err) {
        console.error('[webhook/installation] created — failed to register:', err);
      }
      break;
    }

    case 'deleted': {
      // Mark the installation as inactive across ALL orgs that reference it
      await supabase
        .from('org_github_installations')
        .update({ is_active: false })
        .eq('installation_id', installationId);

      // Clear from any workspaces that reference it
      await supabase
        .from('workspaces')
        .update({ github_installation_id: null })
        .eq('github_installation_id', installationId);

      console.info(
        '[webhook/installation] deleted — deactivated across all orgs and cleared workspace references',
      );
      break;
    }

    case 'suspend': {
      // Mark the installation as inactive across ALL orgs
      await supabase
        .from('org_github_installations')
        .update({ is_active: false })
        .eq('installation_id', installationId);

      console.info('[webhook/installation] suspend — deactivated across all orgs');
      break;
    }

    case 'unsuspend': {
      // Reactivate across ALL orgs
      await supabase
        .from('org_github_installations')
        .update({ is_active: true })
        .eq('installation_id', installationId);

      console.info('[webhook/installation] unsuspend — reactivated across all orgs');
      break;
    }

    case 'new_permissions_accepted': {
      // Fetch updated installation metadata from the GitHub API and refresh
      // the local record. If the GitHub API call fails (e.g., OpenSSL issue,
      // misconfigured keys), log and skip gracefully.
      if (!isGitHubAppConfigured()) {
        console.info(
          '[webhook/installation] new_permissions_accepted — GitHub App not configured, skipping metadata refresh',
        );
        break;
      }

      try {
        const appOctokit = createAppOctokit();
        const { data: inst } = await appOctokit.apps.getInstallation({
          installation_id: installationId,
        });

        const account = inst.account;
        const updates: Record<string, unknown> = {};

        if (account && 'login' in account && account.login) {
          updates.github_account_login = account.login;
        }
        if (account && 'avatar_url' in account && account.avatar_url) {
          updates.github_account_avatar_url = account.avatar_url;
        }
        if (account && 'type' in account && account.type) {
          updates.github_account_type = account.type;
        }

        if (Object.keys(updates).length > 0) {
          // Update ALL org rows that reference this installation
          await supabase
            .from('org_github_installations')
            .update(updates)
            .eq('installation_id', installationId);
        }

        console.info(
          '[webhook/installation] new_permissions_accepted — metadata refreshed across all orgs',
        );
      } catch (err) {
        // Non-fatal: the installation still works, we just couldn't refresh metadata
        console.error(
          '[webhook/installation] new_permissions_accepted — failed to fetch installation metadata (skipping):',
          err instanceof Error ? err.message : err,
        );
      }
      break;
    }

    default: {
      console.info('[webhook/installation] unhandled action:', action);
    }
  }
}

async function handleCheckSuite(payload: Record<string, unknown>) {
  const checkSuite = payload.check_suite as Record<string, unknown>;
  const repoFullName = (payload.repository as Record<string, unknown>)?.full_name as string;
  if (!checkSuite || !repoFullName) return;

  const conclusion = checkSuite.conclusion as string | null; // success, failure, neutral, etc.
  const headSha = checkSuite.head_sha as string;
  const pullRequests = (checkSuite.pull_requests ?? []) as Array<Record<string, unknown>>;

  if (!conclusion || pullRequests.length === 0) return;

  // Map GitHub conclusion to our ci_status
  const ciStatus = conclusion === 'success' ? 'passing' : 'failing';

  const supabase = createServiceClient();
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('repo_url', `https://github.com/${repoFullName}`);

  if (!workspaces?.length) return;

  for (const ws of workspaces) {
    for (const pr of pullRequests) {
      const prNumber = pr.number as number;
      if (!prNumber) continue;
      await supabase
        .from('project_prs')
        .update({ ci_status: ciStatus, head_sha: headSha })
        .eq('workspace_id', ws.id)
        .eq('pr_number', prNumber);
    }
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // Rate limit check — runs before signature verification to save CPU
    if (isRateLimited(request)) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }

    const rawBody = await request.text();
    const signature = request.headers.get('x-hub-signature-256');
    const event = request.headers.get('x-github-event');

    // Verify signature
    if (!verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Dispatch by event type — each handler is wrapped so failures return 500
    // (GitHub retries on 5xx, silently drops on 2xx)
    try {
      switch (event) {
        case 'push':
          await handlePush(payload);
          break;
        case 'pull_request':
          await handlePullRequest(payload);
          break;
        case 'pull_request_review':
          await handlePullRequestReview(payload);
          break;
        case 'create':
          await handleCreate(payload);
          break;
        case 'check_suite':
          await handleCheckSuite(payload);
          break;
        case 'installation':
          await handleInstallation(payload);
          break;
        case 'ping':
          // GitHub sends a ping on webhook creation — just acknowledge
          break;
        default:
          console.info(`[github-webhook] Unhandled event: ${event}`);
      }
    } catch (handlerError) {
      console.error(`[github-webhook] Handler failed for event "${event}":`, handlerError);
      return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[github-webhook] Error processing webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
