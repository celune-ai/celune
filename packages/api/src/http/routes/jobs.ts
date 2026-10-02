import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import {
  claimJob,
  heartbeatJob,
  redactJob,
  submitJobResult,
  type JobCallContext,
  type JobOutcome,
} from '../../jobs/index.ts';
import type { ApiEnv } from '../env.ts';
import { HttpError, parseBody, parseQuery } from '../errors.ts';
import { requirePermission } from '../permissions.ts';

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .optional();

const listQuery = z.object({
  runner: z.enum(['external', 'server']).optional(),
  status: csv,
  target_type: z.enum(['task', 'project']).optional(),
  target_id: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const pendingQuery = z.object({
  queue_name: z.string().optional(),
  job_types: csv,
  limit: z.coerce.number().int().positive().max(50).optional(),
});

const heartbeatBody = z.object({
  progress: z
    .object({
      chunks_received: z.number().optional(),
      tokens_so_far: z.number().optional(),
      partial_result: z.string().optional(),
    })
    .optional(),
});

export const submitBody = z
  .object({
    status: z.enum(['completed', 'failed']),
    job_hmac: z.string(),
    nonce: z.string(),
    result: z
      .object({
        content: z.string(),
        tool_calls: z.array(z.unknown()).optional(),
        usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
        model: z.string().optional(),
        finish_reason: z.string().optional(),
      })
      .optional(),
    error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
  })
  .refine((d) => d.status !== 'completed' || d.result !== undefined, {
    message: 'result is required when status is completed',
    path: ['result'],
  })
  .refine((d) => d.status !== 'failed' || d.error !== undefined, {
    message: 'error is required when status is failed',
    path: ['error'],
  });

export const jobs = new Hono<ApiEnv>();

function ctxOf(c: { var: ApiEnv['Variables'] }): JobCallContext {
  return { auth: c.var.auth, services: c.var.services, host: c.var.host, scope: c.var.scope };
}

function reply<T>(outcome: JobOutcome<T>): { body: unknown; status: ContentfulStatusCode } {
  if (outcome.ok) return { body: outcome.body, status: outcome.status as ContentfulStatusCode };
  throw new HttpError(outcome.status as ContentfulStatusCode, outcome.error);
}

jobs.get('/', async (c) => {
  const q = parseQuery(c, listQuery);
  const page = await c.var.services.jobs.list(c.var.scope, {
    runner: q.runner,
    statuses: q.status,
    targetType: q.target_type,
    targetId: q.target_id,
    limit: q.limit,
    offset: q.offset,
  });
  return c.json({ rows: page.rows.map(redactJob), total: page.total });
});

jobs.get('/pending', async (c) => {
  const q = parseQuery(c, pendingQuery);
  const result = await c.var.services.jobs.poll(c.var.scope, {
    queueName: q.queue_name,
    jobTypes: q.job_types,
    limit: q.limit,
  });
  return c.json({ jobs: result.jobs.map(redactJob), queue_depth: result.queue_depth });
});

jobs.get('/:id', async (c) => {
  const job = await c.var.services.jobs.get(c.var.scope, c.req.param('id'));
  if (!job) throw new HttpError(404, 'Resource not found');
  return c.json(redactJob(job));
});

jobs.post('/:id/claim', async (c) => {
  const { body, status } = reply(await claimJob(ctxOf(c), c.req.param('id')));
  return c.json(body, status);
});

jobs.post('/:id/heartbeat', async (c) => {
  const input = await parseBody(c, heartbeatBody);
  const { body, status } = reply(await heartbeatJob(ctxOf(c), c.req.param('id'), input.progress));
  return c.json(body, status);
});

jobs.post('/:id/result', async (c) => {
  const input = await parseBody(c, submitBody);
  const { body, status } = reply(await submitJobResult(ctxOf(c), c.req.param('id'), input));
  return c.json(body, status);
});

jobs.post('/:id/cancel', async (c) => {
  requirePermission(c, 'tasks:update');
  const job = await c.var.services.jobs.cancel(c.var.scope, c.req.param('id'));
  if (!job) throw new HttpError(409, 'Job is not active');
  return c.json(redactJob(job));
});
