import { HEARTBEAT_EVENT_TYPES } from '@celuneai/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../env.ts';
import { parseBody } from '../errors.ts';
import { requirePermission } from '../permissions.ts';

const statusBody = z.object({
  status: z.enum(['online', 'offline', 'working', 'idle']),
  current_task_id: z.string().uuid().nullable().optional(),
});

const heartbeatBody = z.object({
  agent_id: z.string().trim().min(1),
  event_type: z.enum(HEARTBEAT_EVENT_TYPES),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const agents = new Hono<ApiEnv>();

agents.get('/status', async (c) => {
  return c.json(await c.var.services.agents.listStatus(c.var.scope));
});

agents.put('/:name/status', async (c) => {
  requirePermission(c, 'agents:configure');
  const body = await parseBody(c, statusBody);
  await c.var.services.agents.setStatus(c.var.scope, c.req.param('name'), body.status, {
    currentTaskId: body.current_task_id ?? null,
    userId: c.var.auth.userId,
  });
  return c.body(null, 204);
});

agents.post('/heartbeat', async (c) => {
  requirePermission(c, 'agents:configure');
  const body = await parseBody(c, heartbeatBody);
  await c.var.services.agents.recordHeartbeat(c.var.scope, {
    agentId: body.agent_id,
    eventType: body.event_type,
    metadata: body.metadata,
  });
  return c.json({ ok: true }, 202);
});
