import { z } from 'zod';

export const brainVersionPostSchema = z
  .object({
    workspace_id: z.string().uuid(),
  })
  .strip();

export const brainGenerateSummarySchema = z
  .object({
    workspace_id: z.string().uuid(),
    paths: z.array(z.string().max(500)).max(100).optional(),
  })
  .strip();

export const brainApplyUpdatesSchema = z
  .object({
    workspace_id: z.string().uuid(),
    paths: z.array(z.string().max(500)).max(100).optional(),
    force: z.boolean().optional().default(false),
  })
  .strip();

export const brainMergePreviewSchema = z
  .object({
    workspace_id: z.string().uuid(),
    path: z.string().max(500),
  })
  .strip();

export const brainMergeResolveSchema = z
  .object({
    workspace_id: z.string().uuid(),
    path: z.string().max(500),
    resolutions: z
      .array(
        z.object({
          section_key: z.string().max(200),
          choice: z.enum(['keep-local', 'accept-new', 'custom']),
          custom_content: z.string().max(50_000).optional(),
        }),
      )
      .max(200),
  })
  .strip()
  .refine(
    (data) =>
      data.resolutions.every(
        (r) => r.choice !== 'custom' || (r.custom_content !== undefined && r.custom_content !== ''),
      ),
    { message: 'custom_content is required when choice is "custom"' },
  );
