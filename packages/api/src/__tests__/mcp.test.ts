import { createScope } from '@celuneai/core';
import { z } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { CORE_TOOLS } from '../mcp/registry.ts';
import { textResult, type McpToolHandler } from '../mcp/types.ts';
import { createTestApi, type TestApi } from '../testing/index.ts';

const WS = '11111111-1111-4111-8111-111111111111';
const scope = createScope({ workspaceId: WS });

let api: TestApi;
let token: string;
let nextId = 1;

async function rpc(method: string, params: Record<string, unknown> = {}, authToken = token) {
  const res = await api.request('/mcp', {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    token: authToken,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { result: any; error?: { message: string } };
}

async function call(name: string, args: Record<string, unknown> = {}, authToken = token) {
  const { result, error } = await rpc('tools/call', { name, arguments: args }, authToken);
  expect(error).toBeUndefined();
  return { text: result.content[0].text as string, isError: !!result.isError };
}

beforeEach(async () => {
  api = await createTestApi();
  token = (await api.addKey({ workspaceId: WS, userId: 'user-1' })).raw;
});

describe('MCP over /mcp', () => {
  it('lists the package tools and filters them by scope', async () => {
    const all = await rpc('tools/list');
    const names = all.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(CORE_TOOLS.map((t) => t.name).sort());
    expect(names.length).toBe(19);

    const readOnly = (await api.addKey({ workspaceId: WS, scopes: ['read'] })).raw;
    const limited = await rpc('tools/list', {}, readOnly);
    const limitedNames = limited.result.tools.map((t: { name: string }) => t.name);
    expect(limitedNames).toContain('list_tasks');
    expect(limitedNames).not.toContain('create_task');
    expect(limitedNames).not.toContain('claim_job');
  });

  it('rejects unauthenticated calls with JSON', async () => {
    const res = await api.request('/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });

  it('runs one tool per group', async () => {
    api.store.seedTask(scope, { title: 'Seeded', status: 'in_progress' });

    const tasks = await call('list_tasks', {});
    expect(tasks.isError).toBe(false);
    expect(JSON.parse(tasks.text)[0].title).toBe('Seeded');

    const project = await call('create_project', { name: 'MCP project' });
    expect(project.isError).toBe(false);
    expect(project.text).toContain('Created project: MCP project');

    const pulse = await call('get_workspace_pulse', {});
    expect(JSON.parse(pulse.text).active_tasks.count).toBe(1);

    api.store.seedJob(scope, { id: 'job-1' });
    const jobs = await call('poll_pending_jobs', {});
    expect(JSON.parse(jobs.text).queue_depth).toBe(1);

    const me = await call('whoami', {});
    expect(JSON.parse(me.text)).toMatchObject({
      user_id: 'user-1',
      workspace_id: WS,
      principal: 'api_key',
    });
  });

  it('works for a host JWT and refuses a workspace override', async () => {
    const jwt = await api.mintJwt({ workspace_id: WS, sub: 'host-user' });
    const me = await call('whoami', {}, jwt);
    expect(JSON.parse(me.text)).toMatchObject({ user_id: 'host-user', principal: 'jwt' });
    const other = await call(
      'list_tasks',
      { workspace_id: '22222222-2222-4222-8222-222222222222' },
      jwt,
    );
    expect(other.isError).toBe(true);
    expect(other.text).toContain('scoped to another workspace');
  });

  it('lets a host tool replace a package tool by name', async () => {
    const custom: McpToolHandler = {
      name: 'whoami',
      description: 'host whoami',
      schema: z.object({}),
      scope: 'public',
      group: 'workspace',
      execute: async () => textResult('host says hi'),
    };
    const hosted = await createTestApi({ extraTools: [custom] });
    api = hosted;
    token = (await hosted.addKey({ workspaceId: WS })).raw;
    const me = await call('whoami', {});
    expect(me.text).toBe('host says hi');
    const names = (await rpc('tools/list')).result.tools.map((t: { name: string }) => t.name);
    expect(names.filter((n: string) => n === 'whoami').length).toBe(1);
  });
});

describe('MCP and host JWT embed tokens', () => {
  const createTask = (authToken: string) =>
    api.request('/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { title: 'from embed' } },
      }),
      token: authToken,
    });

  it('refuses a JWT carrying a permissions claim, even with the matching key', async () => {
    for (const permissions of [['tasks:read'], ['tasks:read', 'tasks:create', 'tasks:update']]) {
      const jwt = await api.mintJwt({ workspace_id: WS, scopes: ['write'], permissions });
      const res = await createTask(jwt);
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toBe(
        'Embed tokens cannot call MCP. Use an API key.',
      );
    }
    expect([...api.store.taskRows.values()].some((t) => t.title === 'from embed')).toBe(false);
  });

  it('still serves write tools to API keys and to JWTs without a permissions claim', async () => {
    const byKey = await call('create_task', { title: 'from key' });
    expect(byKey.isError).toBe(false);
    const jwt = await api.mintJwt({ workspace_id: WS, scopes: ['write'] });
    const res = await createTask(jwt);
    expect(res.status).toBe(200);
    expect([...api.store.taskRows.values()].map((t) => t.title)).toContain('from embed');
  });

  it('createMcpServer refuses an embed-token principal as a backstop', async () => {
    const { createMcpServer } = await import('../mcp/server.ts');
    const auth = {
      principal: 'jwt' as const,
      workspaceId: WS,
      orgId: null,
      userId: 'u',
      scopes: ['write' as const],
      keyId: null,
      environment: 'live' as const,
      realtimeEnabled: false,
      permissions: ['tasks:create'],
    };
    expect(() =>
      createMcpServer({ auth, context: { auth, services: api.services, host: {} } }),
    ).toThrow('Embed tokens cannot call MCP');
  });
});
