import { z } from 'zod';

export const hookNotifySchema = z
  .object({
    event: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    severity: z.enum(['info', 'warning', 'error']).optional().default('info'),
    source: z.string().max(200).optional(),
    details: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional()
      .nullable(),
    task_id: z.string().uuid().optional(),
    agent_id: z.string().max(100).optional(),
  })
  .strip();
