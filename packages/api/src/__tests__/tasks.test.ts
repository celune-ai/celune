import { createScope } from '@celuneai/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../testing/index.ts';

const WS = '11111111-1111-4111-8111-111111111111';
const scope = createScope({ workspaceId: WS });

let api: TestApi;
let token: string;

beforeEach(async () => {
  api = await createTestApi();
  token = (await api.addKey({ workspaceId: WS, userId: 'user-1' })).raw;
});

const json = (body: unknown) => JSON.stringify(body);

describe('tasks routes', () => {
  it('creates, reads, lists, and patches a task', async () => {
    const created = await api.request('/tasks', {
      method: 'POST',
      body: json({ title: 'Ship it', priority: 'high' }),
      token,
    });
    expect(created.status).toBe(201);
    const task = await created.json();
    expect(task).toMatchObject({
      title: 'Ship it',
      priority: 'high',
      status: 'inbox',
      source: 'api',
    });

    const fetched = await api.request(`/tasks/${task.id}`, { token });
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).id).toBe(task.id);

    const listed = await api.request('/tasks?status=inbox', { token });
    expect((await listed.json()).length).toBe(1);

    const patched = await api.request(`/tasks/${task.id}`, {
      method: 'PATCH',
      body: json({ title: 'Ship it now', status: 'planning' }),
      token,
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ title: 'Ship it now', status: 'planning' });
  });

  it('rejects an invalid body and an invalid transition', async () => {
    const bad = await api.request('/tasks', { method: 'POST', body: json({}), token });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Invalid request body');

    const seeded = api.store.seedTask(scope, { title: 'x', status: 'inbox' });
    const res = await api.request(`/tasks/${seeded.id}`, {
      method: 'PATCH',
      body: json({ status: 'done' }),
      token,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('invalid_transition');
  });

  it('answers 404 for a missing task with a generic body', async () => {
    const res = await api.request('/tasks/00000000-0000-4000-8000-000000000000', { token });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Resource not found' });
  });

  it('claims, blocks, unblocks, and completes', async () => {
    const seeded = api.store.seedTask(scope, { title: 'work', status: 'planning' });
    const claimed = await api.request(`/tasks/${seeded.id}/claim`, {
      method: 'POST',
      body: json({ agent_id: 'rick' }),
      token,
    });
    expect(claimed.status).toBe(200);
    expect((await claimed.json()).status).toBe('in_progress');

    const blocked = await api.request(`/tasks/${seeded.id}/block`, {
      method: 'POST',
      body: json({ reason: 'waiting on review' }),
      token,
    });
    expect((await blocked.json()).metadata).toMatchObject({
      blocked: true,
      blocked_reason: 'waiting on review',
    });

    const unblocked = await api.request(`/tasks/${seeded.id}/unblock`, { method: 'POST', token });
    expect((await unblocked.json()).metadata.blocked).toBeFalsy();

    const completed = await api.request(`/tasks/${seeded.id}/complete`, {
      method: 'POST',
      body: json({ outcome: 'shipped' }),
      token,
    });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({ status: 'done', outcome: 'shipped' });
  });

  it('adds and lists comments', async () => {
    const seeded = api.store.seedTask(scope, { title: 'talk' });
    const added = await api.request(`/tasks/${seeded.id}/comments`, {
      method: 'POST',
      body: json({ content: 'hello' }),
      token,
    });
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject({ content: 'hello', author: 'user-1' });
    const listed = await api.request(`/tasks/${seeded.id}/comments`, { token });
    expect((await listed.json()).length).toBe(1);
  });

  it('deletes a task', async () => {
    const seeded = api.store.seedTask(scope, { title: 'gone' });
    const res = await api.request(`/tasks/${seeded.id}`, { method: 'DELETE', token });
    expect(res.status).toBe(204);
    expect((await api.request(`/tasks/${seeded.id}`, { token })).status).toBe(404);
  });

  it('never leaks another workspace', async () => {
    const other = api.store.seedTask(
      createScope({ workspaceId: '22222222-2222-4222-8222-222222222222' }),
      {
        title: 'secret',
      },
    );
    expect((await api.request(`/tasks/${other.id}`, { token })).status).toBe(404);
    expect((await api.request(`/tasks/${other.id}/claim`, { method: 'POST', token })).status).toBe(
      404,
    );
  });
});
