import type { ProjectCreateInput, ProjectPatch } from '@celuneai/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../env.ts';
import { parseBody, parseQuery } from '../errors.ts';
import { requirePermission } from '../permissions.ts';

const listQuery = z.object({
  name_prefix: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const projectFields = {
  description: z.string().nullable().optional(),
  project_type: z.enum(['feature', 'system', 'research', 'plan']).optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
  group_id: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  prd_content: z.string().nullable().optional(),
};

const createBody = z.object({ name: z.string().trim().min(1), ...projectFields });
const reorderBody = z
  .array(
    z.object({
      id: z.string().min(1),
      sort_order: z.number(),
      // Accepted for compatibility with the board payload; the store writes sort order only.
      group_id: z.string().nullable().optional(),
    }),
  )
  .min(1)
  .max(500);
const patchBody = z.object({
  name: z.string().trim().min(1).optional(),
  sort_order: z.number().int().optional(),
  ...projectFields,
});

export const projects = new Hono<ApiEnv>();

projects.get('/', async (c) => {
  const q = parseQuery(c, listQuery);
  const rows = await c.var.services.projects.list(c.var.scope, {
    namePrefix: q.name_prefix,
    limit: q.limit,
  });
  return c.json(rows);
});

projects.post('/', async (c) => {
  requirePermission(c, 'projects:create');
  const body = await parseBody(c, createBody);
  const input = {
    ...body,
    project_type: body.project_type ?? 'feature',
    status: body.status ?? 'active',
    user_id: c.var.auth.userId,
  } as ProjectCreateInput;
  const project = await c.var.services.projects.create(c.var.scope, input, c.var.actor);
  return c.json(project, 201);
});

projects.get('/progress', async (c) => {
  return c.json(await c.var.services.projects.progress(c.var.scope));
});

projects.put('/reorder', async (c) => {
  requirePermission(c, 'projects:update');
  const items = await parseBody(c, reorderBody);
  await c.var.services.projects.reorder(
    c.var.scope,
    items.map(({ id, sort_order }) => ({ id, sort_order })),
  );
  return c.json({ ok: true });
});

projects.get('/:id/progress-log', async (c) => {
  const entries = await c.var.services.projects.progressLog(c.var.scope, c.req.param('id'));
  return c.json({ entries });
});

projects.get('/:id', async (c) => {
  const id = c.req.param('id');
  const project = await c.var.services.projects.get(c.var.scope, id);
  const projectTasks = await c.var.services.tasks.list(c.var.scope, { projectId: id });
  return c.json({ ...project, tasks: projectTasks });
});

projects.patch('/:id', async (c) => {
  requirePermission(c, 'projects:update');
  const body = await parseBody(c, patchBody);
  const project = await c.var.services.projects.update(
    c.var.scope,
    c.req.param('id'),
    body as ProjectPatch,
    c.var.actor,
  );
  return c.json(project);
});

projects.delete('/:id', async (c) => {
  requirePermission(c, 'projects:delete');
  await c.var.services.projects.delete(c.var.scope, c.req.param('id'), c.var.actor);
  return c.body(null, 204);
});
