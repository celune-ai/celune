import { toExecutionView } from '@celuneai/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../env.ts';
import { HttpError, parseBody, parseQuery } from '../errors.ts';
import { requirePermission } from '../permissions.ts';

const listQuery = z.object({
  task_id: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const cancelBody = z.object({
  task_id: z.string().min(1).optional(),
  execution_id: z.string().min(1).optional(),
});

/** Server runs: jobs the host's in-process worker executes (runner `server`). */
export const executions = new Hono<ApiEnv>();

executions.get('/', async (c) => {
  const q = parseQuery(c, listQuery);
  const { rows, total } = await c.var.services.jobs.listRuns(c.var.scope, {
    taskId: q.task_id,
    status: q.status,
    limit: q.limit,
    offset: q.offset,
  });
  const decrypt = c.var.host.jobs?.crypto?.decrypt;
  return c.json({ executions: rows.map((row) => toExecutionView(row, decrypt)), total });
});

executions.post('/cancel', async (c) => {
  requirePermission(c, 'tasks:update');
  const body = await parseBody(c, cancelBody);
  if (!body.task_id && !body.execution_id) {
    throw new HttpError(400, 'Provide task_id or execution_id');
  }
  const job = await c.var.services.jobs.cancelRun(c.var.scope, {
    taskId: body.task_id,
    executionId: body.execution_id,
  });
  if (!job) return c.json({ cancelled: false, message: 'No active execution found' });
  return c.json({ cancelled: true, execution_id: job.id });
});
