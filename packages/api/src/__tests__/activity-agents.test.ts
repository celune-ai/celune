import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../testing/index.ts';

const WS = '11111111-1111-4111-8111-111111111111';

let api: TestApi;
let token: string;

beforeEach(async () => {
  api = await createTestApi();
  token = (await api.addKey({ workspaceId: WS })).raw;
});

describe('activity route', () => {
  it('lists the activity a service call appended', async () => {
    await api.request('/tasks', { method: 'POST', body: JSON.stringify({ title: 'a' }), token });
    const res = await api.request('/activity?event_type=task.created', { token });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.total).toBe(1);
    expect(page.data[0].event_type).toBe('task.created');
  });

  it('validates the query', async () => {
    expect((await api.request('/activity?task_id=nope', { token })).status).toBe(400);
  });
});

describe('agents routes', () => {
  it('sets and lists status, records heartbeats', async () => {
    const put = await api.request('/agents/rick/status', {
      method: 'PUT',
      body: JSON.stringify({ status: 'working' }),
      token,
    });
    expect(put.status).toBe(204);
    const list = await api.request('/agents/status', { token });
    expect(await list.json()).toEqual([
      expect.objectContaining({ agent_name: 'rick', status: 'working' }),
    ]);

    const beat = await api.request('/agents/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'rick', event_type: 'health_check', metadata: { n: 1 } }),
      token,
    });
    expect(beat.status).toBe(202);
    expect(api.store.heartbeatRows.length).toBe(1);

    // The database check constraint allows a closed set; anything else is a 400, not a 500.
    const unknown = await api.request('/agents/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'rick', event_type: 'tick' }),
      token,
    });
    expect(unknown.status).toBe(400);
    expect(api.store.heartbeatRows.length).toBe(1);
  });

  it('refuses agent writes and job cancel for a JWT without the RBAC key', async () => {
    const jwt = await api.mintJwt({
      workspace_id: WS,
      scopes: ['write'],
      permissions: ['tasks:read', 'tasks:create'],
    });
    const put = await api.request('/agents/rick/status', {
      method: 'PUT',
      body: JSON.stringify({ status: 'working' }),
      token: jwt,
    });
    expect(put.status).toBe(403);
    const beat = await api.request('/agents/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'rick', event_type: 'tick' }),
      token: jwt,
    });
    expect(beat.status).toBe(403);
    const cancel = await api.request('/jobs/job-1/cancel', { method: 'POST', token: jwt });
    expect(cancel.status).toBe(403);
  });
});
