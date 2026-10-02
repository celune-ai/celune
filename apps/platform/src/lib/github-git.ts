/**
 * GitHub Git operations service.
 *
 * Provides branch, commit, and PR operations for agent workflows.
 * All operations are scoped to a workspace's connected repo via installation tokens.
 */

import { createInstallationOctokit } from './github-app';
import { APP_NAME, DOMAIN_MARKETING } from '@/lib/branding';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchInfo {
  name: string;
  sha: string;
  protected: boolean;
  url: string;
}

export interface CommitFile {
  path: string;
  content: string;
  /** 'create' | 'update' | 'delete'. Defaults to 'update' (create-or-update). */
  mode?: 'create' | 'update' | 'delete';
}

export interface PullRequestInfo {
  number: number;
  title: string;
  html_url: string;
  state: string;
  head_branch: string;
  base_branch: string;
  mergeable: boolean | null;
  review_status: string | null;
}

export interface CommitResult {
  sha: string;
  html_url: string;
  message: string;
}

export interface ReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  html_url: string;
  user: string;
}

// ---------------------------------------------------------------------------
// Helper: parse owner/repo from full_name
// ---------------------------------------------------------------------------

function parseRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) throw new Error(`Invalid repo full_name: ${fullName}`);
  return { owner, repo };
}

// ---------------------------------------------------------------------------
// Branch operations
// ---------------------------------------------------------------------------

/**
 * List branches on the connected repo.
 */
export async function listBranches(
  installationId: number,
  repoFullName: string,
): Promise<BranchInfo[]> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  const branches: BranchInfo[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.repos.listBranches({
      owner,
      repo,
      per_page: 100,
      page,
    });

    for (const b of data) {
      branches.push({
        name: b.name,
        sha: b.commit.sha,
        protected: b.protected,
        url: `https://github.com/${repoFullName}/tree/${b.name}`,
      });
    }

    if (data.length < 100) break;
    page++;
  }

  return branches;
}

/**
 * Create a new branch from a ref (default: HEAD of default branch).
 */
export async function createBranch(
  installationId: number,
  repoFullName: string,
  branchName: string,
  fromRef?: string,
): Promise<BranchInfo> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  // Resolve the base SHA
  let baseSha: string;
  if (fromRef) {
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${fromRef}`,
    });
    baseSha = ref.object.sha;
  } else {
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${repoData.default_branch}`,
    });
    baseSha = ref.object.sha;
  }

  const { data } = await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });

  return {
    name: branchName,
    sha: data.object.sha,
    protected: false,
    url: `https://github.com/${repoFullName}/tree/${branchName}`,
  };
}

/**
 * Delete a branch.
 */
export async function deleteBranch(
  installationId: number,
  repoFullName: string,
  branchName: string,
): Promise<void> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  await octokit.git.deleteRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
  });
}

// ---------------------------------------------------------------------------
// Commit operations (using Git Trees API for multi-file commits)
// ---------------------------------------------------------------------------

/**
 * Commit multiple files to a branch in a single commit.
 * Uses the Git Trees API for atomic multi-file commits.
 */
export async function commitFiles(
  installationId: number,
  repoFullName: string,
  branch: string,
  files: CommitFile[],
  message: string,
  author?: { name: string; email: string },
): Promise<CommitResult> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  // Get the current commit SHA for the branch
  const { data: ref } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const baseSha = ref.object.sha;

  // Get the base tree
  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });

  // Create blobs for each file and build tree entries
  const treeEntries: Array<{
    path: string;
    mode: '100644';
    type: 'blob';
    sha: string | null;
  }> = [];

  for (const file of files) {
    if (file.mode === 'delete') {
      // Null SHA deletes the file
      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: null,
      });
    } else {
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo,
        content: file.content,
        encoding: 'utf-8',
      });
      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
    }
  }

  // Create a new tree
  const { data: tree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.tree.sha,
    tree: treeEntries,
  });

  // Create the commit
  const commitAuthor = author ?? {
    name: process.env.GIT_COMMIT_AUTHOR_NAME ?? `${APP_NAME} Bot`,
    email: process.env.GIT_COMMIT_AUTHOR_EMAIL ?? `bot@${DOMAIN_MARKETING}`,
  };
  const { data: commit } = await octokit.git.createCommit({
    owner,
    repo,
    message,
    tree: tree.sha,
    parents: [baseSha],
    author: {
      name: commitAuthor.name,
      email: commitAuthor.email,
      date: new Date().toISOString(),
    },
  });

  // Update the branch ref to point to the new commit
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.sha,
  });

  return {
    sha: commit.sha,
    html_url: `https://github.com/${repoFullName}/commit/${commit.sha}`,
    message: commit.message,
  };
}

// ---------------------------------------------------------------------------
// Pull Request operations
// ---------------------------------------------------------------------------

/**
 * Create a pull request.
 */
export async function createPullRequest(
  installationId: number,
  repoFullName: string,
  options: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  },
): Promise<PullRequestInfo> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: options.title,
    body: options.body,
    head: options.head,
    base: options.base,
    draft: options.draft ?? false,
  });

  return {
    number: pr.number,
    title: pr.title,
    html_url: pr.html_url,
    state: pr.state,
    head_branch: pr.head.ref,
    base_branch: pr.base.ref,
    mergeable: pr.mergeable,
    review_status: null,
  };
}

/**
 * Get PR info by number.
 */
export async function getPullRequest(
  installationId: number,
  repoFullName: string,
  prNumber: number,
): Promise<PullRequestInfo> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });

  // Get latest review status
  const { data: reviews } = await octokit.pulls.listReviews({
    owner,
    repo,
    pull_number: prNumber,
  });
  const latestReview = reviews.filter((r) => r.state !== 'COMMENTED').pop();

  return {
    number: pr.number,
    title: pr.title,
    html_url: pr.html_url,
    state: pr.state,
    head_branch: pr.head.ref,
    base_branch: pr.base.ref,
    mergeable: pr.mergeable,
    review_status: latestReview?.state ?? null,
  };
}

/**
 * Merge a pull request.
 */
export async function mergePullRequest(
  installationId: number,
  repoFullName: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
): Promise<{ sha: string; merged: boolean }> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  const { data } = await octokit.pulls.merge({
    owner,
    repo,
    pull_number: prNumber,
    merge_method: method,
  });

  return { sha: data.sha, merged: data.merged };
}

// ---------------------------------------------------------------------------
// PR Review operations (for SCAN agent)
// ---------------------------------------------------------------------------

/**
 * Submit a PR review (approve or request changes).
 */
export async function submitPRReview(
  installationId: number,
  repoFullName: string,
  prNumber: number,
  options: {
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
    body: string;
    comments?: Array<{
      path: string;
      line: number;
      body: string;
    }>;
  },
): Promise<{ id: number; state: string; html_url: string }> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  const { data: review } = await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event: options.event,
    body: options.body,
    comments: options.comments,
  });

  return {
    id: review.id,
    state: review.state,
    html_url: review.html_url,
  };
}

/**
 * Reply to a specific PR review comment.
 */
export async function replyToPRComment(
  installationId: number,
  repoFullName: string,
  prNumber: number,
  commentId: number,
  body: string,
): Promise<{ id: number; html_url: string }> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  const { data } = await octokit.pulls.createReplyForReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    comment_id: commentId,
    body,
  });

  return { id: data.id, html_url: data.html_url };
}

/**
 * List review comments on a PR.
 */
export async function listPRReviewComments(
  installationId: number,
  repoFullName: string,
  prNumber: number,
): Promise<ReviewComment[]> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  const allComments: ReviewComment[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await octokit.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
      per_page: perPage,
      page,
    });

    for (const c of data) {
      allComments.push({
        id: c.id,
        body: c.body,
        path: c.path,
        line: c.line ?? c.original_line ?? null,
        html_url: c.html_url,
        user: c.user?.login ?? 'unknown',
      });
    }

    if (data.length < perPage) break;
    page++;
  }

  return allComments;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Get the default branch name for a repo.
 */
export async function getDefaultBranch(
  installationId: number,
  repoFullName: string,
): Promise<string> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.repos.get({ owner, repo });
  return data.default_branch;
}

/**
 * Get branch status (ahead/behind default branch).
 */
export async function getBranchStatus(
  installationId: number,
  repoFullName: string,
  branch: string,
  baseBranch?: string,
): Promise<{ ahead: number; behind: number; status: string }> {
  const octokit = await createInstallationOctokit(installationId);
  const { owner, repo } = parseRepo(repoFullName);

  const base = baseBranch ?? (await getDefaultBranch(installationId, repoFullName));

  const { data } = await octokit.repos.compareCommits({
    owner,
    repo,
    base,
    head: branch,
  });

  return {
    ahead: data.ahead_by,
    behind: data.behind_by,
    status: data.status,
  };
}
