import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRestTransport } from '../transport/rest';
import { CeluneTransportError, type CeluneTransport } from '../transport/types';

const API = 'https://host.example/api/v1';

interface Call {
  method: string;
  url: string;
  auth: string | null;
}

function recordingFetch(calls: Call[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? 'GET',
      url: String(input),
      auth: headers.get('authorization'),
    });
    const path = new URL(String(input)).pathname;
    let body: unknown = {};
    if (path.endsWith('/tasks') || path.endsWith('/projects') || path.endsWith('/comments')) {
      body = [];
    }
    if (path.endsWith('/tasks/count')) body = { count: 3 };
    if (path.endsWith('/activity')) body = { data: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

class FakeXhr {
  static opened: { method: string; url: string; headers: Record<string, string> }[] = [];
  status = 201;
  responseText = JSON.stringify({ attachments: [], errors: [] });
  upload = { addEventListener: () => undefined };
  private listeners: Record<string, () => void> = {};
  private current = { method: '', url: '', headers: {} as Record<string, string> };
  addEventListener(event: string, fn: () => void) {
    this.listeners[event] = fn;
  }
  open(method: string, url: string) {
    this.current = { method, url, headers: {} };
  }
  setRequestHeader(key: string, value: string) {
    this.current.headers[key] = value;
  }
  send() {
    FakeXhr.opened.push(this.current);
    this.listeners.load?.();
  }
}

/** One call per transport member; the keys must cover every member the transport exposes. */
const EXERCISE: Record<string, (t: CeluneTransport) => Promise<unknown>> = {
  'tasks.list': (t) => t.tasks.list({ projectId: 'p1', pageSize: 50, offset: 50 }),
  'tasks.count': (t) => t.tasks.count({ projectId: 'p1' }),
  'tasks.get': (t) => t.tasks.get('t1'),
  'tasks.create': (t) => t.tasks.create({ title: 'x' }),
  'tasks.update': (t) => t.tasks.update('t1', { priority: 'high' }),
  'tasks.remove': (t) => t.tasks.remove('t1'),
  'tasks.reorder': (t) => t.tasks.reorder!([{ id: 't1', sort_order: 0, status: 'inbox' }]),
  'tasks.dependencies': (t) => t.tasks.dependencies!('t1'),
  'tasks.children': (t) => t.tasks.children!('t1'),
  'tasks.spawned': (t) => t.tasks.spawned!('t1'),
  'tasks.context': (t) => t.tasks.context!('t1'),
  'tasks.usage': (t) => t.tasks.usage!('t1'),
  'tasks.initiate': (t) => t.tasks.initiate!('t1'),
  'comments.list': (t) => t.comments.list('t1'),
  'comments.create': (t) => t.comments.create('t1', { content: 'hi', author: 'eric' }),
  'activity.list': (t) => t.activity.list({ taskId: 't1', limit: 5 }),
  'projects.list': (t) => t.projects.list(),
  'projects.reorder': (t) => t.projects.reorder!([{ id: 'p1', sort_order: 0 }]),
  'projects.progressLog': (t) => t.projects.progressLog!('p1'),
  'attachments.list': (t) => t.attachments!.list('t1'),
  'attachments.upload': (t) => t.attachments!.upload('t1', [new File(['x'], 'a.txt')]),
  'attachments.remove': (t) => t.attachments!.remove('t1', 'a1'),
  'executions.list': (t) => t.executions!.list({ taskId: 't1', limit: 10 }),
  'executions.cancel': (t) => t.executions!.cancel({ taskId: 't1' }),
};

function memberNames(transport: CeluneTransport): string[] {
  const names: string[] = [];
  for (const [group, members] of Object.entries(transport)) {
    for (const [name, value] of Object.entries(members as object)) {
      if (typeof value === 'function') names.push(`${group}.${name}`);
    }
  }
  return names.sort();
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXhr.opened = [];
});

describe('createRestTransport', () => {
  it('implements every transport member and sends each one to the v1 mount only', async () => {
    const calls: Call[] = [];
    const transport = createRestTransport({
      apiUrl: `${API}/`,
      getToken: () => 'jwt-token',
      fetch: recordingFetch(calls),
    });

    expect(memberNames(transport)).toEqual(Object.keys(EXERCISE).sort());
    for (const run of Object.values(EXERCISE)) await run(transport);

    expect(calls.length).toBeGreaterThanOrEqual(Object.keys(EXERCISE).length);
    for (const call of calls) {
      expect(call.url.startsWith(`${API}/`), call.url).toBe(true);
      expect(call.auth).toBe('Bearer jwt-token');
    }
    const routes = new Set(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`));
    for (const route of [
      'GET /api/v1/tasks/count',
      'PATCH /api/v1/tasks/t1',
      'PUT /api/v1/tasks/reorder',
      'GET /api/v1/tasks/t1/dependencies',
      'POST /api/v1/tasks/t1/initiate',
      'PUT /api/v1/projects/reorder',
      'GET /api/v1/projects/p1/progress-log',
      'POST /api/v1/tasks/t1/attachments',
      'DELETE /api/v1/tasks/t1/attachments/a1',
      'GET /api/v1/executions',
      'POST /api/v1/executions/cancel',
    ]) {
      expect(routes.has(route), route).toBe(true);
    }
    const list = calls.find((c) => c.url.includes('/tasks?'));
    expect(new URL(list!.url).searchParams.toString()).toBe(
      'project_id=p1&limit=50&offset=50&top_level_only=true',
    );
  });

  it('uploads with progress through XHR on the v1 mount with the bearer token', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const transport = createRestTransport({
      apiUrl: API,
      getToken: () => 'jwt-token',
      fetch: recordingFetch([]),
    });
    const onProgress = vi.fn();
    const result = await transport.attachments!.upload('t1', [new File(['x'], 'a.txt')], {
      onProgress,
    });
    expect(result).toEqual({ attachments: [], errors: [] });
    expect(FakeXhr.opened).toEqual([
      {
        method: 'POST',
        url: `${API}/tasks/t1/attachments`,
        headers: { Authorization: 'Bearer jwt-token' },
      },
    ]);
  });

  it('puts a per-call workspace on comment and execution calls, and raises CeluneTransportError', async () => {
    const calls: Call[] = [];
    const transport = createRestTransport({
      apiUrl: API,
      getToken: () => null,
      workspaceId: 'ws-1',
      fetch: recordingFetch(calls),
    });
    await transport.comments.create('t1', { content: 'x', workspaceId: 'ws-2' });
    await transport.executions!.list({ taskId: 't1', workspaceId: 'ws-2' });
    expect(calls.map((c) => new URL(c.url).searchParams.get('workspace_id'))).toEqual([
      'ws-2',
      'ws-2',
    ]);
    expect(calls[0]?.auth).toBeNull();

    const failing = createRestTransport({
      apiUrl: API,
      getToken: () => 't',
      fetch: (async () =>
        new Response(JSON.stringify({ error: 'nope' }), { status: 403 })) as typeof fetch,
    });
    await expect(failing.tasks.get('t1')).rejects.toBeInstanceOf(CeluneTransportError);
  });
});
