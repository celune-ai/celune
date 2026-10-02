import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// Activity schemas
export const createActivitySchema = z
  .object({
    event_type: z.string().min(1).max(200),
    severity: z.enum(['info', 'warning', 'error']),
    source: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    details: z.record(z.string(), z.unknown()).nullable().optional(),
    task_id: z.string().uuid().nullable().optional(),
    actor_user_id: z.string().uuid().nullable().optional(),
  })
  .strip();

export const acknowledgeActivitySchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1),
  })
  .strip();

export const updateProfileSchema = z
  .object({
    first_name: z.string().max(50).optional(),
    display_name: z.string().max(100).optional(),
    avatar_url: z.string().max(2048).optional(),
    org_name: z.string().max(100).optional(),
  })
  .strip();
