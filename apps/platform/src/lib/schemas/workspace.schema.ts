import { z } from 'zod';

export const workspaceStateSchema = z
  .object({
    workspace_id: z.string().uuid(),
    workspace_name: z.string().min(1).max(255),
    slug: z.string().min(1).max(100),
  })
  .strip();

export const updateWorkspaceSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    icon: z.string().max(10).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    repo_url: z.string().url().max(500).nullable().optional(),
    github_installation_id: z.number().int().nullable().optional(),
    github_settings: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strip();
