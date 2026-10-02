import {
  isLifecycleStatus,
  type AttachmentFile,
  type TaskCreateInput,
  type TaskLifecycleStatus,
  type TaskPatch,
} from '@celuneai/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { isEmbedToken } from '../../auth/types.ts';
import type { ApiEnv } from '../env.ts';
import { HttpError, parseBody, parseQuery } from '../errors.ts';
import { notifyTaskChange, requirePermission } from '../permissions.ts';

const lifecycleStatus = z.string().refine(isLifecycleStatus, { message: 'Unknown task status' });

const listQuery = z.object({
  status: lifecycleStatus.optional(),
  project_id: z.string().optional(),
  assignee: z.string().optional(),
  limit: z.coerce.number().int().positive().max(2000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  include_archived: z.enum(['true', 'false']).optional(),
  top_level_only: z.enum(['true', 'false']).optional(),
});

const countQuery = z.object({
  status: lifecycleStatus.optional(),
  project_id: z.string().optional(),
  top_level_only: z.enum(['true', 'false']).optional(),
});

const taskFields = {
  description: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  assignee: z.string().optional(),
  project_id: z.string().uuid().nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  depends_on: z.array(z.string().uuid()).optional(),
  category: z.array(z.string()).optional(),
  due_date: z.string().nullable().optional(),
  effort: z.enum(['S', 'M', 'L']).nullable().optional(),
  time_estimate_minutes: z.number().int().nullable().optional(),
  source_ref: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  subtasks: z
    .array(z.object({ title: z.string(), done: z.boolean() }))
    .nullable()
    .optional(),
  success_criteria: z.record(z.string(), z.unknown()).nullable().optional(),
};

const createBody = z.object({
  title: z.string().trim().min(1),
  status: lifecycleStatus.optional(),
  source: z.string().optional(),
  spawned_by: z.string().max(500).nullable().optional(),
  vault_path: z.string().max(1000).nullable().optional(),
  time_spent_minutes: z.number().int().nonnegative().nullable().optional(),
  context_keys: z.array(z.string()).optional(),
  sort_order: z.number().optional(),
  ...taskFields,
});

const patchBody = z.object({
  title: z.string().trim().min(1).optional(),
  status: lifecycleStatus.optional(),
  sort_order: z.number().optional(),
  completed_at: z.string().nullable().optional(),
  ...taskFields,
});

const reorderBody = z
  .array(
    z.object({
      id: z.string().min(1),
      status: lifecycleStatus,
      sort_order: z.number(),
    }),
  )
  .min(1)
  .max(500);

const claimBody = z.object({ agent_id: z.string().trim().min(1).optional() });
const completeBody = z.object({
  outcome: z.string().nullable().optional(),
  agent_id: z.string().optional(),
});
const blockBody = z.object({ reason: z.string().trim().min(1) });
const commentBody = z.object({
  content: z.string().trim().min(1),
  author: z.string().trim().min(1).optional(),
});

export const tasks = new Hono<ApiEnv>();

tasks.get('/', async (c) => {
  const q = parseQuery(c, listQuery);
  const rows = await c.var.services.tasks.list(c.var.scope, {
    status: q.status,
    projectId: q.project_id,
    assignee: q.assignee,
    limit: q.limit,
    offset: q.offset,
    includeArchived: q.include_archived === 'true',
    topLevelOnly: q.top_level_only === 'true',
  });
  return c.json(rows);
});

tasks.get('/count', async (c) => {
  const q = parseQuery(c, countQuery);
  const count = await c.var.services.tasks.count(c.var.scope, {
    status: q.status,
    projectId: q.project_id,
    topLevelOnly: q.top_level_only === 'true',
  });
  return c.json({ count });
});

tasks.post('/', async (c) => {
  requirePermission(c, 'tasks:create');
  const body = await parseBody(c, createBody);
  const host = c.var.host;
  if (body.assignee && host.agents?.isEmployed) {
    const employed = await host.agents.isEmployed(c.var.scope.workspaceId, body.assignee);
    if (!employed) {
      throw new HttpError(422, `Agent "${body.assignee}" is not employed in this workspace`);
    }
  }
  const input = {
    ...body,
    user_id: c.var.auth.userId,
    source: body.source ?? 'api',
  } as TaskCreateInput;
  const task = await c.var.services.tasks.create(c.var.scope, input, c.var.actor);
  await notifyTaskChange(c, { kind: 'created', scope: c.var.scope, actor: c.var.actor, task });
  return c.json(task, 201);
});

tasks.put('/reorder', async (c) => {
  requirePermission(c, 'tasks:update');
  const items = await parseBody(c, reorderBody);
  const changed = await c.var.services.tasks.reorder(
    c.var.scope,
    items.map((item) => ({ ...item, status: item.status as TaskLifecycleStatus })),
    c.var.actor,
  );
  for (const result of changed) {
    await notifyTaskChange(c, {
      kind: 'updated',
      scope: c.var.scope,
      actor: c.var.actor,
      ...result,
    });
  }
  return c.json({ ok: true });
});

tasks.get('/:id', async (c) => {
  const task = await c.var.services.tasks.get(c.var.scope, c.req.param('id'));
  return c.json(task);
});

tasks.patch('/:id', async (c) => {
  requirePermission(c, 'tasks:update');
  const body = await parseBody(c, patchBody);
  const result = await c.var.services.tasks.update(
    c.var.scope,
    c.req.param('id'),
    body as TaskPatch,
    c.var.actor,
  );
  await notifyTaskChange(c, { kind: 'updated', scope: c.var.scope, actor: c.var.actor, ...result });
  return c.json(result.task);
});

tasks.delete('/:id', async (c) => {
  requirePermission(c, 'tasks:delete');
  await c.var.services.tasks.delete(c.var.scope, c.req.param('id'), c.var.actor);
  return c.body(null, 204);
});

tasks.get('/:id/dependencies', async (c) => {
  const dependencies = await c.var.services.tasks.dependencies(c.var.scope, c.req.param('id'));
  return c.json({ dependencies });
});

tasks.get('/:id/children', async (c) => {
  const { children, allComplete } = await c.var.services.tasks.children(
    c.var.scope,
    c.req.param('id'),
  );
  return c.json({ children, all_complete: allComplete });
});

tasks.get('/:id/spawned', async (c) => {
  const spawned = await c.var.services.tasks.spawned(c.var.scope, c.req.param('id'));
  return c.json({ tasks: spawned });
});

tasks.get('/:id/context', async (c) => {
  const task = await c.var.services.tasks.get(c.var.scope, c.req.param('id'));
  const keys = task.context_keys ?? [];
  const lookup = c.var.host.tasks?.context;
  const entries = keys.length > 0 && lookup ? await lookup(c.var.scope, keys) : [];
  return c.json({ context_keys: keys, entries });
});

tasks.get('/:id/usage', async (c) => {
  const id = c.req.param('id');
  await c.var.services.tasks.get(c.var.scope, id);
  const usage = c.var.host.tasks?.usage;
  return c.json(usage ? await usage(c.var.scope, id) : { hasUsage: false });
});

tasks.post('/:id/initiate', async (c) => {
  requirePermission(c, 'tasks:update');
  const result = await c.var.services.tasks.initiate(c.var.scope, c.req.param('id'), c.var.actor);
  await notifyTaskChange(c, { kind: 'updated', scope: c.var.scope, actor: c.var.actor, ...result });
  let executionId: string | null = null;
  const enqueue = c.var.host.executions?.enqueue;
  if (enqueue) {
    try {
      const job = await enqueue({
        scope: c.var.scope,
        task: result.task,
        agentId: result.agentId,
        userId: c.var.auth.userId,
      });
      executionId = job?.id ?? null;
    } catch (error) {
      console.warn('[celune-api] server run enqueue failed', error);
    }
  }
  return c.json({ ...result.task, execution_id: executionId });
});

tasks.get('/:id/attachments', async (c) => {
  return c.json(await c.var.services.attachments.list(c.var.scope, c.req.param('id')));
});

tasks.post('/:id/attachments', async (c) => {
  requirePermission(c, 'tasks:update');
  const form = await c.req.formData().catch(() => {
    throw new HttpError(400, 'Expected multipart form data');
  });
  const files = form
    .getAll('files')
    .filter((entry): entry is File => typeof entry === 'object' && entry !== null);
  const uploadedBy = form.get('uploaded_by');
  const result = await c.var.services.attachments.upload(
    c.var.scope,
    c.req.param('id'),
    files as AttachmentFile[],
    typeof uploadedBy === 'string' && uploadedBy ? uploadedBy : c.var.auth.userId,
    c.var.actor,
  );
  if (result.attachments.length === 0) {
    return c.json({ error: 'All uploads failed', details: result.errors }, 400);
  }
  return c.json(result, 201);
});

tasks.delete('/:id/attachments/:attachmentId', async (c) => {
  requirePermission(c, 'tasks:update');
  await c.var.services.attachments.remove(
    c.var.scope,
    c.req.param('id'),
    c.req.param('attachmentId'),
    c.var.actor,
  );
  return c.body(null, 204);
});

tasks.post('/:id/claim', async (c) => {
  requirePermission(c, 'tasks:update');
  const body = await parseBody(c, claimBody);
  const agentId = body.agent_id ?? c.var.auth.userId;
  // Starts a harness run when the agent maps to one; otherwise a plain claim.
  const { task } = await c.var.services.harness.claim(
    c.var.scope,
    c.req.param('id'),
    agentId,
    { ...c.var.actor, agentId },
    { allowRunStart: !isEmbedToken(c.var.auth) },
  );
  return c.json(task);
});

tasks.post('/:id/complete', async (c) => {
  requirePermission(c, 'tasks:update');
  const body = await parseBody(c, completeBody);
  const task = await c.var.services.tasks.complete(
    c.var.scope,
    c.req.param('id'),
    { outcome: body.outcome ?? null, agentId: body.agent_id ?? null },
    c.var.actor,
  );
  return c.json(task);
});

tasks.post('/:id/block', async (c) => {
  requirePermission(c, 'tasks:update');
  const body = await parseBody(c, blockBody);
  const task = await c.var.services.tasks.block(
    c.var.scope,
    c.req.param('id'),
    { reason: body.reason },
    c.var.actor,
  );
  return c.json(task);
});

tasks.post('/:id/unblock', async (c) => {
  requirePermission(c, 'tasks:update');
  const task = await c.var.services.tasks.unblock(c.var.scope, c.req.param('id'), c.var.actor);
  return c.json(task);
});

tasks.get('/:id/comments', async (c) => {
  const id = c.req.param('id');
  await c.var.services.tasks.get(c.var.scope, id);
  const comments = await c.var.services.store.comments.list(c.var.scope, id);
  return c.json(comments);
});

tasks.post('/:id/comments', async (c) => {
  requirePermission(c, 'tasks:update');
  const body = await parseBody(c, commentBody);
  const comment = await c.var.services.tasks.addComment(
    c.var.scope,
    c.req.param('id'),
    { author: body.author ?? c.var.auth.userId, content: body.content, userId: c.var.auth.userId },
    c.var.actor,
  );
  if (!comment) throw new HttpError(500, 'Comment was not stored');
  return c.json(comment, 201);
});
