import { createScope } from '@celuneai/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mintHostJwt, verifyHostJwt } from '../auth/jwt.ts';
import type { ApiHost, ServerRunRequest, TaskChange } from '../host.ts';
import { embedTokenGrant, embedWritePermission } from '../http/permissions.ts';
import { TEST_JWT_SECRET, createTestApi, type TestApi } from '../testing/index.ts';

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const scope = createScope({ workspaceId: WS });
const otherScope = createScope({ workspaceId: OTHER });

let api: TestApi;
let writer: string;
let reader: string;
let changes: TaskChange[];
let enqueue: ReturnType<typeof vi.fn<(r: ServerRunRequest) => Promise<{ id: string } | null>>>;

async function setup(host: ApiHost = {}) {
  changes = [];
  enqueue = vi.fn(async (_r: ServerRunRequest) => ({ id: 'run-1' }) as { id: string } | null);
  api = await createTestApi({
    host: {
      tasks: {
        onChange: (change) => {
          changes.push(change);
        },
        context: async (_scope, keys) => keys.map((k) => ({ id: k, content: `memory ${k}` })),
        usage: async () => ({ hasUsage: true, requests: 2 }),
      },
      executions: { enqueue },
      ...host,
    },
  });
  writer = (await api.addKey({ workspaceId: WS, userId: 'user-1' })).raw;
  reader = (await api.addKey({ workspaceId: WS, userId: 'user-1', scopes: ['read'] })).raw;
}

beforeEach(async () => {
  await setup();
});

const json = (body: unknown) => JSON.stringify(body);

describe('task list paging and count', () => {
  it('pages with limit and offset and counts with the filter', async () => {
    for (let i = 0; i < 4; i++) api.store.seedTask(scope, { title: `t${i}`, sort_order: i });
    api.store.seedTask(scope, { title: 'done', status: 'done', sort_order: 9 });
    const page = await api.request('/tasks?limit=2&offset=1', { token: reader });
    expect((await page.json()).map((t: { title: string }) => t.title)).toEqual(['t1', 't2']);
    const count = await api.request('/tasks/count?status=inbox', { token: reader });
    expect(await count.json()).toEqual({ count: 4 });
  });
});

describe('PUT /tasks/reorder', () => {
  it('moves tasks, reports status changes to the host, and needs write scope', async () => {
    const a = api.store.seedTask(scope, { title: 'a', status: 'review' });
    const b = api.store.seedTask(scope, { title: 'b', status: 'inbox' });
    const body = json([
      { id: a.id, status: 'done', sort_order: 0 },
      { id: b.id, status: 'inbox', sort_order: 1 },
    ]);

    const refused = await api.request('/tasks/reorder', { method: 'PUT', body, token: reader });
    expect(refused.status).toBe(403);
    expect(api.store.taskRows.get(a.id)?.status).toBe('review');

    const res = await api.request('/tasks/reorder', { method: 'PUT', body, token: writer });
    expect(res.status).toBe(200);
    expect(api.store.taskRows.get(a.id)?.status).toBe('done');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'updated', completed: true });
  });

  it('answers 404 when an id belongs to another workspace', async () => {
    const theirs = api.store.seedTask(otherScope, { title: 'theirs' });
    const res = await api.request('/tasks/reorder', {
      method: 'PUT',
      body: json([{ id: theirs.id, status: 'inbox', sort_order: 0 }]),
      token: writer,
    });
    expect(res.status).toBe(404);
  });

  it('rejects a malformed body', async () => {
    const res = await api.request('/tasks/reorder', {
      method: 'PUT',
      body: json([]),
      token: writer,
    });
    expect(res.status).toBe(400);
  });
});

describe('task relations, context, and usage', () => {
  it('serves dependencies, children, spawned, context, and usage', async () => {
    const dep = api.store.seedTask(scope, { title: 'dep' });
    const parent = api.store.seedTask(scope, {
      title: 'parent',
      depends_on: [dep.id],
      context_keys: ['k1'],
    });
    api.store.seedTask(scope, { title: 'kid', parent_id: parent.id, status: 'done' });
    api.store.seedTask(scope, { title: 'follow', spawned_by: parent.id });

    const deps = await (
      await api.request(`/tasks/${parent.id}/dependencies`, { token: reader })
    ).json();
    expect(deps.dependencies.map((t: { id: string }) => t.id)).toEqual([dep.id]);
    const kids = await (
      await api.request(`/tasks/${parent.id}/children`, { token: reader })
    ).json();
    expect(kids).toMatchObject({ all_complete: true });
    expect(kids.children).toHaveLength(1);
    const spawned = await (
      await api.request(`/tasks/${parent.id}/spawned`, { token: reader })
    ).json();
    expect(spawned.tasks.map((t: { title: string }) => t.title)).toEqual(['follow']);
    const ctx = await (await api.request(`/tasks/${parent.id}/context`, { token: reader })).json();
    expect(ctx).toEqual({ context_keys: ['k1'], entries: [{ id: 'k1', content: 'memory k1' }] });
    const usage = await (await api.request(`/tasks/${parent.id}/usage`, { token: reader })).json();
    expect(usage).toEqual({ hasUsage: true, requests: 2 });
  });

  it('answers empty context and usage without host hooks, and 404 across workspaces', async () => {
    await setup({ tasks: {} });
    const t = api.store.seedTask(scope, { title: 't', context_keys: ['k1'] });
    const ctx = await (await api.request(`/tasks/${t.id}/context`, { token: reader })).json();
    expect(ctx.entries).toEqual([]);
    const usage = await (await api.request(`/tasks/${t.id}/usage`, { token: reader })).json();
    expect(usage).toEqual({ hasUsage: false });

    const theirs = api.store.seedTask(otherScope, { title: 'theirs' });
    for (const path of ['dependencies', 'children', 'spawned', 'context', 'usage']) {
      const res = await api.request(`/tasks/${theirs.id}/${path}`, { token: reader });
      expect(res.status, path).toBe(404);
    }
  });
});

describe('POST /tasks/:id/initiate', () => {
  it('starts the task, queues a run through the host, and needs write scope', async () => {
    const t = api.store.seedTask(scope, { title: 'go', status: 'inbox', assignee: 'unassigned' });
    const refused = await api.request(`/tasks/${t.id}/initiate`, { method: 'POST', token: reader });
    expect(refused.status).toBe(403);

    const res = await api.request(`/tasks/${t.id}/initiate`, { method: 'POST', token: writer });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'in_progress', assignee: 'rick', execution_id: 'run-1' });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'rick', userId: 'user-1' }),
    );
    expect(changes.at(-1)).toMatchObject({ kind: 'updated', statusChanged: true });
  });

  it('refuses a done task with 400', async () => {
    const t = api.store.seedTask(scope, { title: 'd', status: 'done' });
    const res = await api.request(`/tasks/${t.id}/initiate`, { method: 'POST', token: writer });
    expect(res.status).toBe(400);
  });
});

describe('project reorder and progress log', () => {
  it('reorders with write scope and lists the progress log', async () => {
    const p = api.store.seedProject(scope, { name: 'P', sort_order: 4 });
    const body = json([{ id: p.id, sort_order: 0, group_id: null }]);
    expect(
      (await api.request('/projects/reorder', { method: 'PUT', body, token: reader })).status,
    ).toBe(403);
    expect(
      (await api.request('/projects/reorder', { method: 'PUT', body, token: writer })).status,
    ).toBe(200);
    expect(api.store.projectRows.get(p.id)?.sort_order).toBe(0);

    api.store.seedTask(scope, {
      title: 'shipped',
      project_id: p.id,
      status: 'done',
      outcome: 'ok',
    });
    const log = await (
      await api.request(`/projects/${p.id}/progress-log`, { token: reader })
    ).json();
    expect(log.entries.map((e: { task_title: string }) => e.task_title)).toEqual(['shipped']);

    const theirs = api.store.seedProject(otherScope, { name: 'Q' });
    expect(
      (await api.request(`/projects/${theirs.id}/progress-log`, { token: reader })).status,
    ).toBe(404);
  });
});

describe('attachments', () => {
  function form(...files: File[]) {
    const data = new FormData();
    for (const f of files) data.append('files', f);
    data.append('uploaded_by', 'eric');
    return data;
  }

  it('uploads, lists, and deletes through v1', async () => {
    const t = api.store.seedTask(scope, { title: 't' });
    const res = await api.request(`/tasks/${t.id}/attachments`, {
      method: 'POST',
      body: form(new File(['# hi'], 'notes.md', { type: 'text/markdown' })),
      token: writer,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attachments[0]).toMatchObject({ file_name: 'notes.md', uploaded_by: 'eric' });
    expect(body.attachments[0].download_url).toMatch(/^memory:\/\//);

    const listed = await (
      await api.request(`/tasks/${t.id}/attachments`, { token: reader })
    ).json();
    expect(listed).toHaveLength(1);

    const del = await api.request(`/tasks/${t.id}/attachments/${listed[0].id}`, {
      method: 'DELETE',
      token: writer,
    });
    expect(del.status).toBe(204);
    expect(api.blobs.objects.size).toBe(0);
  });

  it('answers 400 when every file is refused, 403 for read scope, 404 across workspaces', async () => {
    const t = api.store.seedTask(scope, { title: 't' });
    const bad = await api.request(`/tasks/${t.id}/attachments`, {
      method: 'POST',
      body: form(new File(['x'], 'a.exe', { type: 'application/x-msdownload' })),
      token: writer,
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('All uploads failed');

    const readOnly = await api.request(`/tasks/${t.id}/attachments`, {
      method: 'POST',
      body: form(new File(['x'], 'a.txt', { type: 'text/plain' })),
      token: reader,
    });
    expect(readOnly.status).toBe(403);

    const theirs = api.store.seedTask(otherScope, { title: 'theirs' });
    expect((await api.request(`/tasks/${theirs.id}/attachments`, { token: reader })).status).toBe(
      404,
    );
  });
});

describe('executions', () => {
  it('lists server runs for a task and cancels the active one', async () => {
    api.store.seedJob(scope, {
      id: 'run-1',
      runner: 'server',
      target_type: 'task',
      target_id: 'task-1',
      status: 'claimed',
      metadata: { agent_id: 'sage' },
    });
    api.store.seedJob(scope, {
      id: 'ext-1',
      runner: 'external',
      target_type: 'task',
      target_id: 'task-1',
    });

    const listed = await (
      await api.request('/executions?task_id=task-1', { token: reader })
    ).json();
    expect(listed.executions.map((e: { id: string }) => e.id)).toEqual(['run-1']);
    expect(listed.executions[0]).toMatchObject({
      runner: 'server',
      agent_id: 'sage',
      task_id: 'task-1',
    });

    const refused = await api.request('/executions/cancel', {
      method: 'POST',
      body: json({ task_id: 'task-1' }),
      token: reader,
    });
    expect(refused.status).toBe(403);

    const cancel = await api.request('/executions/cancel', {
      method: 'POST',
      body: json({ task_id: 'task-1' }),
      token: writer,
    });
    expect(await cancel.json()).toEqual({ cancelled: true, execution_id: 'run-1' });
    const again = await api.request('/executions/cancel', {
      method: 'POST',
      body: json({ execution_id: 'ext-1' }),
      token: writer,
    });
    expect(await again.json()).toMatchObject({ cancelled: false });
    const empty = await api.request('/executions/cancel', {
      method: 'POST',
      body: json({}),
      token: writer,
    });
    expect(empty.status).toBe(400);
  });
});

describe('host JWT permissions claim', () => {
  it('refuses a mutation the token lacks the RBAC key for, and allows the ones it has', async () => {
    const t = api.store.seedTask(scope, { title: 't' });
    const member = await api.mintJwt({
      workspace_id: WS,
      scopes: ['write'],
      permissions: ['tasks:read', 'tasks:update'],
    });
    const del = await api.request(`/tasks/${t.id}`, { method: 'DELETE', token: member });
    expect(del.status).toBe(403);
    expect(await del.json()).toMatchObject({ required: 'tasks:delete' });
    const patch = await api.request(`/tasks/${t.id}`, {
      method: 'PATCH',
      body: json({ priority: 'high' }),
      token: member,
    });
    expect(patch.status).toBe(200);
    const create = await api.request('/tasks', {
      method: 'POST',
      body: json({ title: 'x' }),
      token: member,
    });
    expect(create.status).toBe(403);
  });

  it('lets a single write key unlock only its own operations', async () => {
    const t = api.store.seedTask(scope, { title: 't' });
    const deleter = await api.mintJwt({
      workspace_id: WS,
      scopes: ['write'],
      permissions: ['tasks:read', 'tasks:delete'],
    });
    const comment = await api.request(`/tasks/${t.id}/comments`, {
      method: 'POST',
      body: json({ content: 'hi' }),
      token: deleter,
    });
    expect(comment.status).toBe(403);
    expect(await comment.json()).toMatchObject({ required: 'tasks:update' });
    const project = await api.request('/projects', {
      method: 'POST',
      body: json({ name: 'p' }),
      token: deleter,
    });
    expect(project.status).toBe(403);
    const heartbeat = await api.request('/agents/heartbeat', {
      method: 'POST',
      body: json({ agent_id: 'a' }),
      token: deleter,
    });
    expect(heartbeat.status).toBe(403);
    expect(await heartbeat.json()).toMatchObject({ required: 'agents:configure' });
    const del = await api.request(`/tasks/${t.id}`, { method: 'DELETE', token: deleter });
    expect(del.status).toBe(204);
  });

  it('refuses embed tokens on write routes that name no key', async () => {
    const member = await api.mintJwt({
      workspace_id: WS,
      scopes: ['write'],
      permissions: ['tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete'],
    });
    for (const path of ['/jobs/j-1/claim', '/jobs/j-1/heartbeat', '/jobs/j-1/result']) {
      const res = await api.request(path, { method: 'POST', body: json({}), token: member });
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toEqual({ error: 'Embed tokens cannot call this route' });
    }
  });

  it('maps every mutating REST route to a key or to an explicit refusal', () => {
    const refused = new Set([
      'POST /jobs/:id/claim',
      'POST /jobs/:id/heartbeat',
      'POST /jobs/:id/result',
      'POST /harness/events',
      'PUT /harness/connection',
      'DELETE /harness/connection',
      'POST /mcp',
      'DELETE /mcp',
    ]);
    const mutating = api.app.routes.filter(
      (r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && r.path !== '/*',
    );
    expect(mutating.length).toBeGreaterThan(15);
    for (const route of mutating) {
      const label = `${route.method} ${route.path}`;
      const key = embedWritePermission(route.method, route.path.replace(/:[a-zA-Z]+/g, 'x'));
      if (refused.has(label)) expect(key, label).toBeNull();
      else expect(key, label).not.toBeNull();
    }
  });

  it('embedTokenGrant asks for write only with a write key and drops unknown keys', () => {
    expect(embedTokenGrant(['tasks:read', 'projects:read', 'billing:manage'])).toEqual({
      scopes: ['read'],
      permissions: ['tasks:read', 'projects:read'],
    });
    expect(embedTokenGrant(['tasks:read', 'tasks:assign', 'projects:update'])).toEqual({
      scopes: ['write'],
      permissions: ['tasks:read', 'projects:update'],
    });
  });

  it('requires the matching read key on reads when the token carries permissions', async () => {
    const t = api.store.seedTask(scope, { title: 't' });
    const noReads = await api.mintJwt({
      workspace_id: WS,
      scopes: ['read'],
      permissions: ['tasks:update'],
    });
    for (const path of ['/tasks', `/tasks/${t.id}`, '/projects', '/jobs', '/executions']) {
      const res = await api.request(path, { token: noReads });
      expect(res.status, path).toBe(403);
    }
    const taskList = await api.request('/tasks', { token: noReads });
    expect(await taskList.json()).toMatchObject({ required: 'tasks:read' });
    const feed = await api.request('/activity', { token: noReads });
    expect(await feed.json()).toMatchObject({ required: 'analytics:read' });
    const agents = await api.request('/agents/status', { token: noReads });
    expect(await agents.json()).toMatchObject({ required: 'agents:read' });

    const reader = await api.mintJwt({
      workspace_id: WS,
      scopes: ['read'],
      permissions: ['tasks:read', 'projects:read'],
    });
    for (const path of ['/tasks', `/tasks/${t.id}`, '/projects', `/activity?task_id=${t.id}`]) {
      const res = await api.request(path, { token: reader });
      expect(res.status, path).toBe(200);
    }
    expect((await api.request('/activity', { token: reader })).status).toBe(403);
  });

  it('keeps scope-only behavior for API keys and for JWTs without a permissions claim', async () => {
    const key = await api.addKey({ workspaceId: WS, scopes: ['read'] });
    const plain = await api.mintJwt({ workspace_id: WS, scopes: ['read'] });
    for (const token of [key.raw, plain]) {
      for (const path of ['/tasks', '/projects', '/activity', '/agents/status']) {
        expect((await api.request(path, { token })).status, path).toBe(200);
      }
    }
  });

  it('mintHostJwt produces a token the verifier accepts, permissions included', async () => {
    const token = await mintHostJwt(
      {
        sub: 'user-9',
        workspace_id: WS,
        org_id: 'org-1',
        scopes: ['read'],
        permissions: ['tasks:read'],
      },
      { secret: TEST_JWT_SECRET, expiresInSeconds: 60 },
    );
    const result = await verifyHostJwt(token, { secret: TEST_JWT_SECRET });
    expect(result).toMatchObject({
      ok: true,
      auth: { principal: 'jwt', userId: 'user-9', orgId: 'org-1', permissions: ['tasks:read'] },
    });
    const jwtRes = await api.request('/tasks', { token });
    expect(jwtRes.status).toBe(200);
  });
});

describe('create validation', () => {
  it('refuses an assignee the host says is not employed, and accepts follow-up fields', async () => {
    await setup({ agents: { isEmployed: async (_ws, agent) => agent === 'rick' } });
    const origin = api.store.seedTask(scope, { title: 'origin' });
    const bad = await api.request('/tasks', {
      method: 'POST',
      body: json({ title: 'x', assignee: 'ghost' }),
      token: writer,
    });
    expect(bad.status).toBe(422);
    const ok = await api.request('/tasks', {
      method: 'POST',
      body: json({ title: 'next', assignee: 'rick', spawned_by: origin.id, context_keys: ['k'] }),
      token: writer,
    });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ spawned_by: origin.id, context_keys: ['k'] });
    expect(changes.at(-1)).toMatchObject({ kind: 'created' });
  });
});
