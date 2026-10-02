import { z } from 'zod';

export const githubReviewSchema = z
  .object({
    workspace_id: z.string().uuid(),
    pr_number: z.number().int().positive(),
    event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
    body: z.string().min(1).max(65_000),
    comments: z
      .array(
        z.object({
          path: z.string().min(1).max(500),
          line: z.number().int().positive(),
          body: z.string().min(1).max(10_000),
        }),
      )
      .max(100)
      .optional(),
  })
  .strip();

export const githubReplySchema = z
  .object({
    workspace_id: z.string().uuid(),
    pr_number: z.number().int().positive(),
    comment_id: z.number().int().positive(),
    body: z.string().min(1).max(10_000),
  })
  .strip();

export const githubSyncInstallationSchema = z
  .object({
    workspace_id: z.string().uuid(),
    installation_id: z.number().int().positive().optional(),
  })
  .strip();

export const githubCallbackPostSchema = z
  .object({
    workspace_id: z.string().uuid(),
    repo_url: z.string().url().max(500),
    repo_path: z.string().max(500).optional(),
    installation_id: z.number().int().positive().optional(),
    default_branch: z.string().max(200).optional(),
  })
  .strip();

export const githubInstallPostSchema = z
  .object({
    workspace_id: z.string().uuid(),
  })
  .strip();

export const githubCreateRepoSchema = z
  .object({
    workspace_id: z.string().uuid(),
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        'Repository name can only contain alphanumeric characters, hyphens, underscores, and dots',
      ),
    description: z.string().max(500).optional(),
    private: z.boolean().optional(),
    org: z.string().max(100).optional(),
  })
  .strip();

export const githubCreatePrSchema = z
  .object({
    workspace_id: z.string().uuid(),
    project_id: z.string().uuid(),
    task_id: z.string().uuid().optional().nullable(),
    pr_number: z.number().int().positive(),
    pr_url: z.string().url().max(500),
    branch_name: z.string().min(1).max(255),
    title: z.string().max(500).optional().nullable(),
    status: z.string().max(50).optional(),
  })
  .strip();

export const githubPatchPrSchema = z
  .object({
    workspace_id: z.string().uuid(),
    status: z.string().max(50).optional(),
    ci_status: z.string().max(50).optional(),
    review_state: z.string().max(50).optional(),
    files_changed: z.number().int().optional(),
    additions: z.number().int().optional(),
    deletions: z.number().int().optional(),
    head_sha: z.string().max(64).optional(),
    commits_behind_main: z.number().int().optional(),
    title: z.string().max(500).optional(),
    merged_at: z.string().optional().nullable(),
    closed_at: z.string().optional().nullable(),
  })
  .strip();

/** Schema for DELETE /api/github/installations (disconnect). */
export const githubDisconnectSchema = z
  .object({
    workspace_id: z.string().uuid(),
  })
  .strip();
