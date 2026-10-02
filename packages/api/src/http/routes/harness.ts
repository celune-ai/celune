import { HARNESS_RUN_STATUSES } from '@celuneai/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { hasScope, isEmbedToken, type AuthContext } from '../../auth/types.ts';
import type { ApiEnv } from '../env.ts';
import { HttpError, parseBody, parseQuery } from '../errors.ts';
import { notifyTaskChange } from '../permissions.ts';

const eventBody = z.object({
  event_id: z.string().trim().min(1).max(200),
  task_id: z.string().trim().min(1).max(100),
  harness: z.string().trim().min(1).max(100),
  run_id: z.string().trim().min(1).max(200),
  status: z.enum(HARNESS_RUN_STATUSES),
  occurred_at: z.iso.datetime({ offset: true }),
  outcome: z.string().max(20_000).nullable().optional(),
  error: z.string().max(4_000).nullable().optional(),
  progress: z.record(z.string(), z.unknown()).optional(),
});

const runsQuery = z.object({
  harness: z.string().trim().min(1).max(100),
});

/**
 * Run events come from a host's server. Embed tokens carry a permissions claim
 * and live in a browser, so they cannot report runs.
 */
export function harnessEventAccessError(auth: AuthContext): string | null {
  if (isEmbedToken(auth)) {
    return 'Embed tokens cannot report harness events. Use a server token or an API key.';
  }
  return null;
}

export const harness = new Hono<ApiEnv>();

const connectionBody = z.object({
  harness: z.string().trim().min(1).max(100),
  agents: z.record(z.string().trim().min(1).max(200), z.string().trim().min(1).max(200)),
  config: z.record(z.string(), z.unknown()).optional(),
  replace: z.boolean().optional(),
});

/** The stored harness connection is workspace configuration: admin keys and server tokens only. */
function requireConnectionAdmin(auth: AuthContext): void {
  if (isEmbedToken(auth)) {
    throw new HttpError(403, 'Embed tokens cannot manage the harness connection');
  }
  if (!hasScope(auth, 'admin')) throw new HttpError(403, 'Insufficient scope. Required: admin');
}

harness.get('/connection', async (c) => {
  requireConnectionAdmin(c.var.auth);
  const connection = await c.var.services.harness.connection(c.var.scope);
  if (!connection) throw new HttpError(404, 'Resource not found');
  return c.json(connection);
});

harness.put('/connection', async (c) => {
  requireConnectionAdmin(c.var.auth);
  const body = await parseBody(c, connectionBody);
  const connection = await c.var.services.harness.connect(c.var.scope, body, c.var.actor);
  return c.json(connection);
});

harness.delete('/connection', async (c) => {
  requireConnectionAdmin(c.var.auth);
  if (!(await c.var.services.harness.disconnect(c.var.scope))) {
    throw new HttpError(404, 'Resource not found');
  }
  return c.body(null, 204);
});

/**
 * Active runs of one harness in the caller's workspace. A host watcher reads
 * this after a restart to resume polling; it takes the same server
 * credentials as the events route.
 */
harness.get('/runs', async (c) => {
  const refusal = harnessEventAccessError(c.var.auth);
  if (refusal) throw new HttpError(403, refusal);
  const query = parseQuery(c, runsQuery);
  const runs = await c.var.services.harness.activeRuns(c.var.scope, query.harness);
  return c.json({ runs });
});

harness.post('/events', async (c) => {
  const refusal = harnessEventAccessError(c.var.auth);
  if (refusal) throw new HttpError(403, refusal);
  const body = await parseBody(c, eventBody);
  const actor = { source: 'harness', userId: c.var.auth.userId };
  const result = await c.var.services.harness.applyEvent(
    c.var.scope,
    {
      id: body.event_id,
      taskId: body.task_id,
      runRef: { harness: body.harness, runId: body.run_id },
      status: body.status,
      occurredAt: body.occurred_at,
      outcome: body.outcome ?? null,
      error: body.error ?? null,
      progress: body.progress,
    },
    actor,
  );
  const statusChanged = result.task.status !== result.previous.status;
  if (result.applied) {
    await notifyTaskChange(c, {
      kind: 'updated',
      scope: c.var.scope,
      actor,
      task: result.task,
      previous: result.previous,
      statusChanged,
      completed: statusChanged && result.task.status === 'done',
    });
  }
  return c.json({
    applied: result.applied,
    duplicate: result.duplicate,
    stale: result.stale,
    task_id: result.task.id,
    task_status: result.task.status,
    run_status: (result.task.metadata as Record<string, { status?: string }> | null)?.harness_run
      ?.status,
  });
});
