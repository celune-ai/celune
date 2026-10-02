import { createScope, LoopbackHarness, type HarnessRunStatus } from '@celuneai/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../testing/index.ts';

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const scope = createScope({ workspaceId: WS });

let api: TestApi;
let token: string;
let loopback: LoopbackHarness;
let seconds = 0;

const at = () => new Date(Date.UTC(2026, 8, 27, 12, 0, seconds++)).toISOString();

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event_id: 'evt-1',
    harness: 'loopback',
    status: 'running',
    occurred_at: at(),
    ...overrides,
  });
}

async function post(payload: string, authToken = token) {
  return api.request('/harness/events', { method: 'POST', body: payload, token: authToken });
}

async function claimedTask() {
  const seeded = api.store.seedTask(scope, { title: 'Harness task', status: 'planning' });
  const res = await api.request(`/tasks/${seeded.id}/claim`, {
    method: 'POST',
    body: JSON.stringify({ agent_id: 'rick' }),
    token,
  });
  expect(res.status).toBe(200);
  const task = await res.json();
  return { task, runId: task.metadata.harness_run.run_id as string };
}

beforeEach(async () => {
  seconds = 0;
  api = await createTestApi();
  token = (await api.addKey({ workspaceId: WS, userId: 'user-1' })).raw;
  loopback = new LoopbackHarness();
  api.services.harness.registry.register(WS, loopback, {
    agents: { rick: 'hw-rick', 'user-1': 'hw-user' },
  });
});

describe('claim starts a harness run', () => {
  it('starts a run from the REST claim route', async () => {
    const { task, runId } = await claimedTask();
    expect(task.status).toBe('in_progress');
    expect(runId).toBe('loopback-run-1');
    expect(loopback.runs.get(runId)?.context.harnessAgentId).toBe('hw-rick');
  });

  it('starts a run from the MCP claim_task tool', async () => {
    const seeded = api.store.seedTask(scope, { title: 'Via MCP', status: 'planning' });
    const res = await api.request('/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'claim_task', arguments: { task_id: seeded.id } },
      }),
      token,
    });
    expect(res.status).toBe(200);
    expect([...loopback.runs.values()].map((r) => r.task.id)).toEqual([seeded.id]);
  });

  it('claims without a run for an unmapped agent', async () => {
    const seeded = api.store.seedTask(scope, { title: 'Plain', status: 'planning' });
    const res = await api.request(`/tasks/${seeded.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'noir' }),
      token,
    });
    expect((await res.json()).metadata.harness_run).toBeUndefined();
    expect(loopback.runs.size).toBe(0);
  });
  it('refuses a run start from an embed JWT and still lets it claim for an unmapped agent', async () => {
    const jwt = await api.mintJwt({
      workspace_id: WS,
      scopes: ['write'],
      permissions: ['tasks:read', 'tasks:update'],
    });
    const seeded = api.store.seedTask(scope, { title: 'Embed claim', status: 'planning' });
    const refused = await api.request(`/tasks/${seeded.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'rick' }),
      token: jwt,
    });
    expect(refused.status).toBe(403);
    expect(loopback.runs.size).toBe(0);

    const plain = await api.request(`/tasks/${seeded.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'noir' }),
      token: jwt,
    });
    expect(plain.status).toBe(200);
    expect(loopback.runs.size).toBe(0);
  });

  it('starts no run when an embed JWT calls the MCP claim_task tool', async () => {
    const jwt = await api.mintJwt({
      workspace_id: WS,
      scopes: ['write'],
      permissions: ['tasks:read', 'tasks:update'],
    });
    const seeded = api.store.seedTask(scope, { title: 'Embed MCP', status: 'planning' });
    const res = await api.request('/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'claim_task', arguments: { task_id: seeded.id } },
      }),
      token: jwt,
    });
    expect(res.status).toBe(403);
    expect(loopback.runs.size).toBe(0);
  });
});

describe('POST /harness/events', () => {
  it('applies a run event and reports the task status', async () => {
    const { task, runId } = await claimedTask();
    const res = await post(
      body({ task_id: task.id, run_id: runId, status: 'succeeded', outcome: 'Done' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      applied: true,
      duplicate: false,
      stale: false,
      task_id: task.id,
      task_status: 'review',
      run_status: 'succeeded',
    });
  });

  it('is idempotent on event id', async () => {
    const { task, runId } = await claimedTask();
    const payload = body({ task_id: task.id, run_id: runId, status: 'succeeded' });
    await post(payload);
    const replay = await post(payload);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      applied: false,
      duplicate: true,
      task_status: 'review',
    });
    const rows = api.store.activityRows.filter((a) => a.event_type === 'harness.run.succeeded');
    expect(rows).toHaveLength(1);
  });

  it('answers 409 when the event would break the transition rules', async () => {
    const seeded = api.store.seedTask(scope, { title: 'Inbox', status: 'inbox' });
    const res = await post(body({ task_id: seeded.id, run_id: 'r1', status: 'succeeded' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('invalid_transition');
  });

  it('answers 400 for an event from a run that is not the active one', async () => {
    const { task } = await claimedTask();
    const res = await post(body({ task_id: task.id, run_id: 'someone-else' }));
    expect(res.status).toBe(400);
  });

  it('validates the body', async () => {
    const bad = await post(
      JSON.stringify({
        event_id: 'e',
        task_id: 't',
        harness: 'h',
        run_id: 'r',
        status: 'exploded',
        occurred_at: 'soon',
      }),
    );
    expect(bad.status).toBe(400);
    const statuses: HarnessRunStatus[] = ['queued', 'waiting'];
    for (const status of statuses) {
      const { task, runId } = await claimedTask();
      const ok = await post(
        body({ event_id: `e-${status}`, task_id: task.id, run_id: runId, status }),
      );
      expect(ok.status).toBe(200);
    }
  });

  it('answers 404 for a task in another workspace', async () => {
    const other = api.store.seedTask(createScope({ workspaceId: OTHER_WS }), { title: 'Theirs' });
    const res = await post(body({ task_id: other.id, run_id: 'r1' }));
    expect(res.status).toBe(404);
  });

  it('accepts a server JWT without a permissions claim', async () => {
    const { task, runId } = await claimedTask();
    const jwt = await api.mintJwt({ workspace_id: WS, scopes: ['write'] });
    const res = await post(body({ task_id: task.id, run_id: runId }), jwt);
    expect(res.status).toBe(200);
  });

  it('refuses an embed JWT that carries a permissions claim', async () => {
    const { task, runId } = await claimedTask();
    const jwt = await api.mintJwt({
      workspace_id: WS,
      scopes: ['write'],
      permissions: ['tasks:read', 'tasks:update'],
    });
    const res = await post(body({ task_id: task.id, run_id: runId }), jwt);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      'Embed tokens cannot report harness events. Use a server token or an API key.',
    );
    expect(api.store.heartbeatRows).toHaveLength(0);
  });

  it('refuses a read-only key and a missing token', async () => {
    const readOnly = (await api.addKey({ workspaceId: WS, scopes: ['read'] })).raw;
    expect((await post(body({ task_id: 't', run_id: 'r' }), readOnly)).status).toBe(403);
    const anonymous = await api.request('/harness/events', {
      method: 'POST',
      body: body({ task_id: 't', run_id: 'r' }),
    });
    expect(anonymous.status).toBe(401);
  });

  it('calls the host task-change hook when the status moves', async () => {
    const changes: string[] = [];
    api = await createTestApi({
      host: { tasks: { onChange: (change) => void changes.push(`${change.kind}`) } },
    });
    token = (await api.addKey({ workspaceId: WS, userId: 'user-1' })).raw;
    loopback = new LoopbackHarness();
    api.services.harness.registry.register(WS, loopback, { agents: { rick: 'hw-rick' } });
    const { task, runId } = await claimedTask();
    await post(body({ task_id: task.id, run_id: runId, status: 'succeeded' }));
    expect(changes).toEqual(['updated']);
  });
});

describe('GET /harness/runs', () => {
  async function list(authToken = token, harness = 'loopback') {
    return api.request(`/harness/runs?harness=${harness}`, { token: authToken });
  }

  it('lists the active runs of one harness in the workspace', async () => {
    const { task, runId } = await claimedTask();
    await post(body({ event_id: `${runId}:dispatch`, task_id: task.id, run_id: runId }));
    const ended = await claimedTask();
    await post(
      body({ event_id: 'done', task_id: ended.task.id, run_id: ended.runId, status: 'succeeded' }),
    );
    api.store.seedTask(createScope({ workspaceId: OTHER_WS }), {
      title: 'Theirs',
      metadata: { harness_run: { harness: 'loopback', run_id: 'x', status: 'running' } },
    });

    const res = await list();
    expect(res.status).toBe(200);
    const { runs } = await res.json();
    expect(runs).toEqual([
      {
        task_id: task.id,
        harness: 'loopback',
        run_id: runId,
        harness_agent: 'hw-rick',
        status: 'running',
        last_event_at: expect.any(String),
        event_ids: [`${runId}:dispatch`],
        run_as: null,
      },
    ]);
    expect((await (await list(token, 'other')).json()).runs).toEqual([]);
  });

  it('requires the harness query', async () => {
    const res = await api.request('/harness/runs', { token });
    expect(res.status).toBe(400);
  });

  it('refuses an embed JWT and a missing token', async () => {
    const jwt = await api.mintJwt({
      workspace_id: WS,
      scopes: ['write'],
      permissions: ['tasks:read'],
    });
    expect((await list(jwt)).status).toBe(403);
    expect((await api.request('/harness/runs?harness=loopback')).status).toBe(401);
    const server = await api.mintJwt({ workspace_id: WS, scopes: ['write'] });
    expect((await list(server)).status).toBe(200);
  });
});

describe('/harness/connection', () => {
  const otherScope = createScope({ workspaceId: OTHER_WS });
  let admin: string;

  function put(payload: Record<string, unknown>, authToken = admin) {
    return api.request('/harness/connection', {
      method: 'PUT',
      body: JSON.stringify(payload),
      token: authToken,
    });
  }

  beforeEach(async () => {
    api.services.harness.registry.registerFactory('loopback', () => new LoopbackHarness());
    admin = (await api.addKey({ workspaceId: OTHER_WS, userId: 'admin-2', scopes: ['admin'] })).raw;
  });

  it('stores a connection that later claims in that workspace use', async () => {
    const res = await put({
      harness: 'loopback',
      agents: { rick: 'hw-rick' },
      config: { baseUrl: 'https://h.test' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ harness: 'loopback', createdBy: 'admin-2' });
    const got = await api.request('/harness/connection', { token: admin });
    expect(await got.json()).toMatchObject({ agents: { rick: 'hw-rick' } });

    const seeded = api.store.seedTask(otherScope, { title: 'Stored', status: 'planning' });
    const claim = await api.request(`/tasks/${seeded.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'rick' }),
      token: admin,
    });
    expect((await claim.json()).metadata.harness_run.harness).toBe('loopback');
  });

  it('refuses keys without admin scope, embed tokens, and credentials in config', async () => {
    const writer = (await api.addKey({ workspaceId: OTHER_WS, scopes: ['write'] })).raw;
    expect((await put({ harness: 'loopback', agents: {} }, writer)).status).toBe(403);
    const embed = await api.mintJwt({
      workspace_id: OTHER_WS,
      scopes: ['admin'],
      permissions: ['tasks:read', 'tasks:update'],
    });
    expect((await put({ harness: 'loopback', agents: {} }, embed)).status).toBe(403);
    expect((await api.request('/harness/connection', { token: embed })).status).toBe(403);
    const secret = await put({ harness: 'loopback', agents: {}, config: { api_key: 'x' } });
    expect(secret.status).toBe(400);
    expect((await api.request('/harness/connection', { token: admin })).status).toBe(404);
  });

  it('keeps each workspace to its own connection', async () => {
    expect((await put({ harness: 'loopback', agents: { rick: 'hw-rick' } })).status).toBe(200);
    const wsAdmin = (await api.addKey({ workspaceId: WS, scopes: ['admin'] })).raw;
    expect((await api.request('/harness/connection', { token: wsAdmin })).status).toBe(404);
    const across = await api.request(`/harness/connection?workspace_id=${OTHER_WS}`, {
      token: wsAdmin,
    });
    expect(across.status).toBe(403);
    const del = await api.request(`/harness/connection?workspace_id=${OTHER_WS}`, {
      method: 'DELETE',
      token: wsAdmin,
    });
    expect(del.status).toBe(403);
    expect((await api.request('/harness/connection', { token: admin })).status).toBe(200);
  });

  it('deletes the connection, then answers 404', async () => {
    await put({ harness: 'loopback', agents: {} });
    const del = await api.request('/harness/connection', { method: 'DELETE', token: admin });
    expect(del.status).toBe(204);
    const again = await api.request('/harness/connection', { method: 'DELETE', token: admin });
    expect(again.status).toBe(404);
  });
});
