import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../env.ts';
import { parseQuery } from '../errors.ts';

const listQuery = z.object({
  event_type: z.string().optional(),
  task_id: z.string().uuid().optional(),
  agent_id: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const activity = new Hono<ApiEnv>();

activity.get('/', async (c) => {
  const q = parseQuery(c, listQuery);
  const page = await c.var.services.store.activity.list(c.var.scope, q);
  return c.json(page);
});
