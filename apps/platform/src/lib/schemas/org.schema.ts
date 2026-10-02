import { z } from 'zod';

export const orgSettingsSchema = z
  .object({
    reuse_agents_across_workspaces: z.boolean().optional(),
    sharing_enabled: z.boolean().optional(),
    auto_open_urls: z.boolean().optional(),
  })
  .strip();

export const orgPermissionOverrideSchema = z
  .object({
    workspace_id: z.string().uuid(),
    role_slug: z.string().min(1).max(50),
    permission_key: z.string().min(1).max(100),
    enabled: z.boolean(),
  })
  .strip();
