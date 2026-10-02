import { z } from 'zod';

export const createApiKeySchema = z
  .object({
    name: z.string().min(1).max(100),
    workspace_id: z.string().uuid(),
    environment: z.enum(['live', 'test']).default('live'),
    scopes: z
      .array(z.enum(['read', 'write', 'admin']))
      .min(1)
      .default(['read']),
    /** Granular permission keys — when provided, takes precedence over scopes */
    permission_scopes: z.array(z.string()).min(1).optional(),
    rate_limit_per_minute: z.number().int().min(1).max(10000).optional(),
    expires_at: z.string().datetime().optional(),
  })
  .strip();

export const updateApiKeySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    scopes: z
      .array(z.enum(['read', 'write', 'admin']))
      .min(1)
      .optional(),
    permission_scopes: z.array(z.string()).min(1).optional(),
    rate_limit_per_minute: z.number().int().min(1).max(10000).optional(),
    expires_at: z.string().datetime().nullable().optional(),
    realtime_enabled: z.boolean().optional(),
  })
  .strip();
