import { z } from 'zod';

export const costIngestSchema = z
  .object({
    session_id: z.string().min(1),
    model: z.string().min(1),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_cost_usd: z.number().nonnegative(),
    agent_name: z.string().optional(),
    task_id: z.string().optional(),
    cache_read_tokens: z.number().int().nonnegative().optional(),
    cache_creation_tokens: z.number().int().nonnegative().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    workspace_id: z.string().uuid().optional(),
  })
  .strip();
