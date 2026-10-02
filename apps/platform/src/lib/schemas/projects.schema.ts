import { z } from 'zod';
import { PROJECT_STATUSES, PROJECT_TYPES, PROJECT_PRIORITIES, PRD_STATUSES } from '@repo/types';

const prdMetadataSchema = z
  .object({
    author: z.string(),
    status: z.enum(PRD_STATUSES),
    agents_involved: z.array(z.string()),
    created_date: z.string(),
    reviewed_by: z.array(z.string()).optional(),
    review_date: z.string().optional(),
  })
  .strip();

export const createProjectSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().nullable().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    project_type: z.enum(PROJECT_TYPES).optional(),
    priority: z.enum(PROJECT_PRIORITIES).optional(),
    category: z.string().nullable().optional(),
    target_date: z.string().nullable().optional(),
    vault_path: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    prd_content: z.string().nullable().optional(),
    prd_metadata: prdMetadataSchema.nullable().optional(),
    group_id: z.string().uuid().nullable().optional(),
    workspace_id: z.string().uuid(),
    sort_order: z.number().optional(),
  })
  .strip();

export const updateProjectSchema = createProjectSchema.omit({ workspace_id: true }).partial();

export const createProjectGroupSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().nullable().optional(),
    sort_order: z.number().optional(),
  })
  .strip();

export const updateProjectGroupSchema = createProjectGroupSchema.partial();

export const reorderProjectGroupSchema = z.array(
  z.object({ id: z.string().uuid(), sort_order: z.number() }).strip(),
);

export const reorderProjectSchema = z.array(
  z
    .object({
      id: z.string().uuid(),
      sort_order: z.number(),
      group_id: z.string().uuid().nullable().optional(),
    })
    .strip(),
);
