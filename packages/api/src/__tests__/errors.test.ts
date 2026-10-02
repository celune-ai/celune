import { createScope, InvalidTransition } from '@celuneai/core';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_ID_HEADER } from '../index.ts';
import { createTestApi, type TestApi } from '../testing/index.ts';

const WS = '11111111-1111-4111-8111-111111111111';
const scope = createScope({ workspaceId: WS });

let api: TestApi;
let token: string;
let logged: string[];

beforeEach(async () => {
  api = await createTestApi({ basePath: '/api/v1' });
  token = (await api.addKey({ workspaceId: WS })).raw;
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('error responses', () => {
  it('maps a raw store error object to internal_error with a request id and logs it', async () => {
    // PostgREST hands back plain objects; Hono does not pass those to onError.
    api.store.tasks.list = async () => {
      throw { code: '42703', message: 'column tasks.nope does not exist', details: null };
    };
    const res = await api.request('/tasks?status=planning', { token });
    expect(res.status).toBe(500);
    const requestId = res.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await res.json()).toEqual({ error: 'internal_error', request_id: requestId });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(`request_id=${requestId}`);
    expect(logged[0]).toContain('route="GET /api/v1/tasks"');
    expect(logged[0]).toContain('[42703] column tasks.nope does not exist');
    expect(logged[0]).not.toContain(token);
    expect(logged[0]).not.toContain('status=planning');
  });

  it('maps a thrown Error the same way and never logs the request body', async () => {
    api.store.tasks.create = async () => {
      throw new Error('connection reset');
    };
    const res = await api.request('/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'secret-looking title sk_live_123' }),
      token,
      headers: { [REQUEST_ID_HEADER]: 'req-abc.123' },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('req-abc.123');
    expect(await res.json()).toEqual({ error: 'internal_error', request_id: 'req-abc.123' });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('Error: connection reset');
    expect(logged[0]).not.toContain('sk_live_123');
  });

  it('replaces an unsafe incoming request id', async () => {
    const res = await api.request('/tasks', {
      token,
      headers: { [REQUEST_ID_HEADER]: 'bad id with spaces' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps status and code for typed domain errors', async () => {
    api.store.tasks.list = async () => {
      throw new InvalidTransition('done', 'planning');
    };
    const res = await api.request('/tasks', { token });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Invalid status transition: done -> planning',
      code: 'invalid_transition',
    });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    expect(logged).toEqual([]);
  });

  it('keeps 404 for a missing task and sets the request id on success', async () => {
    const missing = await api.request('/tasks/00000000-0000-4000-8000-000000000000', { token });
    expect(missing.status).toBe(404);
    const seeded = api.store.seedTask(scope, { title: 'Here' });
    const ok = await api.request(`/tasks/${seeded.id}`, { token });
    expect(ok.status).toBe(200);
    expect(ok.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    expect(logged).toEqual([]);
  });

  it('maps raw errors the same way when mounted inside a parent app', async () => {
    // apps/api and the Headways sidecar mount the package app with app.route('/', api).
    const parent = new Hono();
    parent.route('/', api.app);
    api.store.tasks.list = async () => {
      throw { message: 'relation "tasks" does not exist', code: '42P01' };
    };
    const res = await parent.request('/api/v1/tasks', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'internal_error', request_id: expect.any(String) });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(body.request_id);
    expect(logged).toHaveLength(1);
  });
});
