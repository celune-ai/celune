import { createScope } from '@celuneai/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../testing/index.ts';

const WS = '11111111-1111-4111-8111-111111111111';
const scope = createScope({ workspaceId: WS });

let api: TestApi;
let token: string;

beforeEach(async () => {
  api = await createTestApi();
  token = (await api.addKey({ workspaceId: WS })).raw;
});

describe('projects routes', () => {
  it('creates, lists, reads with tasks, patches, and deletes', async () => {
    const created = await api.request('/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Launch', project_type: 'plan' }),
      token,
    });
    expect(created.status).toBe(201);
    const project = await created.json();
    expect(project).toMatchObject({ name: 'Launch', project_type: 'plan', status: 'active' });

    api.store.seedTask(scope, { title: 'child', project_id: project.id });
    const fetched = await api.request(`/projects/${project.id}`, { token });
    const body = await fetched.json();
    expect(body.tasks.map((t: { title: string }) => t.title)).toEqual(['child']);

    const listed = await api.request('/projects', { token });
    expect((await listed.json()).length).toBe(1);

    const patched = await api.request(`/projects/${project.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'updated' }),
      token,
    });
    expect((await patched.json()).description).toBe('updated');

    const progress = await api.request('/projects/progress', { token });
    expect(progress.status).toBe(200);
    expect((await progress.json())[project.id]).toMatchObject({ taskCount: 1, doneCount: 0 });

    expect((await api.request(`/projects/${project.id}`, { method: 'DELETE', token })).status).toBe(
      204,
    );
    expect((await api.request(`/projects/${project.id}`, { token })).status).toBe(404);
  });

  it('rejects a bad body', async () => {
    const res = await api.request('/projects', { method: 'POST', body: '{"name":""}', token });
    expect(res.status).toBe(400);
  });
});
