/**
 * Platform routes on a real Supabase stack: brain and workspace export and
 * import, the embed token route, and the platform's /api/v1 mount (REST and
 * MCP, including the platform-only memory tools). Workspace A's user and API
 * key try to reach workspace B; B's rows are compared before and after.
 *
 * Only rate limiting, CSRF, and the cookie session factory are replaced. The
 * session factory returns a real GoTrue session for the acting user, so API
 * key auth, membership, RBAC resolution, and every query run for real.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { verifyHostJwt } from '@celuneai/api';
import { resolveHostConfig } from '@celuneai/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@repo/db/server', () => ({ createClient: async () => session.client }));
vi.mock('@/lib/rate-limiter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limiter')>()),
  applyRateLimit: vi.fn(async () => null),
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 1000,
    limit: 1000,
    resetAt: new Date(Date.now() + 60_000),
  })),
}));
vi.mock('@/lib/csrf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csrf')>()),
  validateOrigin: vi.fn(async () => null),
}));

import { GET as brainExport } from '@/app/api/brain/export/route';
import { POST as brainImport } from '@/app/api/brain/import/route';
import { POST as embedToken } from '@/app/api/embed/token/route';
import * as v1 from '@/app/api/v1/[[...route]]/route';
import { GET as workspaceExport } from '@/app/api/workspace/export/route';
import { POST as workspaceImport } from '@/app/api/workspace/import/route';

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the isolation suite`);
  return value;
}

const RUN = randomUUID().slice(0, 8);
const MARK = `bmark-${RUN}`;
const A_MARK = `amark-${RUN}`;
const URL_ = env('NEXT_PUBLIC_SUPABASE_URL');
const ANON = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const JWT_SECRET = env('CELUNE_HOST_JWT_SECRET');
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, env('SUPABASE_SERVICE_ROLE_KEY'), clientOptions);

interface Tenant {
  userId: string;
  email: string;
  password: string;
  workspaceId: string;
  orgId: string;
  key: string;
}

let A: Tenant;
let B: Tenant;
const b = { task: '', project: '', memory: '' };

async function createTenant(label: string): Promise<Tenant> {
  const email = `platform-isolation-${label}-${RUN}@example.test`;
  const password = randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  const { data: org } = await admin
    .from('organizations')
    .select('id')
    .eq('owner_id', data.user.id)
    .single();
  const { data: ws } = await admin
    .from('workspaces')
    .select('id')
    .eq('org_id', org!.id)
    .eq('is_default', true)
    .single();
  const prefix = resolveHostConfig(process.env).apiKeyPrefix;
  const key = `${prefix}_live_${randomBytes(24).toString('hex')}`;
  const { error: keyError } = await admin.from('api_keys').insert({
    workspace_id: ws!.id,
    org_id: org!.id,
    user_id: data.user.id,
    name: `platform isolation ${RUN}`,
    key_hash: createHash('sha256').update(key).digest('hex'),
    key_prefix: key.slice(0, prefix.length + 8),
    environment: 'live',
    scopes: ['read', 'write', 'admin'],
  });
  if (keyError) throw new Error(`api key ${label}: ${keyError.message}`);
  return {
    userId: data.user.id,
    email,
    password,
    workspaceId: ws!.id,
    orgId: org!.id,
    key,
  };
}

async function signIn(tenant: Tenant): Promise<SupabaseClient> {
  const client = createClient(URL_, ANON, clientOptions);
  const { error } = await client.auth.signInWithPassword({
    email: tenant.email,
    password: tenant.password,
  });
  if (error) throw new Error(`sign in: ${error.message}`);
  return client;
}

function req(
  method: string,
  path: string,
  opts: { token?: string; userId?: string; body?: string; type?: string } = {},
): NextRequest {
  const headers: Record<string, string> = { accept: 'application/json, text/event-stream' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.userId) headers['x-user-id'] = opts.userId;
  if (opts.body !== undefined) headers['content-type'] = opts.type ?? 'application/json';
  return new NextRequest(`http://localhost:3000${path}`, { method, headers, body: opts.body });
}

async function snapshot() {
  const inB = async (table: string) => {
    const { data, error } = await admin
      .from(table)
      .select('*')
      .eq('workspace_id', B.workspaceId)
      .order('created_at');
    if (error) throw new Error(`${table} snapshot: ${error.message}`);
    return data;
  };
  return {
    memory: await inB('agent_memory'),
    tasks: await inB('tasks'),
    projects: await inB('projects'),
  };
}
let before: Awaited<ReturnType<typeof snapshot>>;

beforeAll(async () => {
  [A, B] = [await createTenant('a'), await createTenant('b')];
  const { data: project, error: pErr } = await admin
    .from('projects')
    .insert({ name: `P ${MARK}`, workspace_id: B.workspaceId, org_id: B.orgId, user_id: B.userId })
    .select('id')
    .single();
  if (pErr) throw new Error(`project: ${pErr.message}`);
  b.project = project.id;
  const { data: task, error: tErr } = await admin
    .from('tasks')
    .insert({
      title: `T ${MARK}`,
      workspace_id: B.workspaceId,
      org_id: B.orgId,
      user_id: B.userId,
      project_id: b.project,
    })
    .select('id')
    .single();
  if (tErr) throw new Error(`task: ${tErr.message}`);
  b.task = task.id;
  const memory = (tenant: Tenant, mark: string) => ({
    key: `memory-${mark}`,
    content: `content ${mark}`,
    workspace_id: tenant.workspaceId,
    org_id: tenant.orgId,
    user_id: tenant.userId,
  });
  const { data: mems, error: mErr } = await admin
    .from('agent_memory')
    .insert([memory(A, A_MARK), memory(B, MARK)])
    .select('id, workspace_id');
  if (mErr) throw new Error(`memory: ${mErr.message}`);
  b.memory = mems!.find((m) => m.workspace_id === B.workspaceId)!.id;
  // A key of B's that shares A's stored prefix: the stored prefix keeps only two
  // random characters, so lookups must match on the hash, not expect one row.
  const prefixLength = resolveHostConfig(process.env).apiKeyPrefix.length + 8;
  const { error: decoyError } = await admin.from('api_keys').insert({
    workspace_id: B.workspaceId,
    org_id: B.orgId,
    user_id: B.userId,
    name: `platform isolation decoy ${RUN}`,
    key_hash: createHash('sha256').update(`decoy-${RUN}`).digest('hex'),
    key_prefix: A.key.slice(0, prefixLength),
    environment: 'live',
    scopes: ['read', 'write', 'admin'],
  });
  if (decoyError) throw new Error(`decoy key: ${decoyError.message}`);
  before = await snapshot();
});

afterAll(async () => {
  for (const tenant of [A, B]) {
    if (!tenant) continue;
    await admin.from('organizations').delete().eq('id', tenant.orgId);
    await admin.auth.admin.deleteUser(tenant.userId);
  }
});

describe('brain export and import', () => {
  it('exports only the key workspace, whatever workspace_id says', async () => {
    for (const query of ['', `&workspace_id=${B.workspaceId}`]) {
      const res = await brainExport(
        req('GET', `/api/brain/export?compress=false${query}`, { token: A.key }),
      );
      const text = await res.text();
      expect(text).not.toContain(MARK);
      if (res.status === 200) expect(text).toContain(A_MARK);
    }
  });

  it('refuses a session export of a workspace the user is not a member of', async () => {
    session.client = await signIn(A);
    const own = await brainExport(
      req('GET', `/api/brain/export?compress=false&workspace_id=${A.workspaceId}`),
    );
    expect(own.status).toBe(200);
    const res = await brainExport(
      req('GET', `/api/brain/export?compress=false&workspace_id=${B.workspaceId}`),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(MARK);
  });

  it('refuses imports into B from A', async () => {
    session.client = await signIn(A);
    const exported = await brainExport(
      req('GET', `/api/brain/export?compress=false&workspace_id=${A.workspaceId}`),
    );
    const doc = await exported.text();
    const bySession = await brainImport(
      req('POST', `/api/brain/import?workspace_id=${B.workspaceId}&mode=overwrite`, {
        body: doc,
      }),
    );
    expect(bySession.status).toBe(403);
    const byKey = await brainImport(
      req('POST', `/api/brain/import?workspace_id=${B.workspaceId}&mode=overwrite`, {
        token: A.key,
        body: doc,
      }),
    );
    expect(byKey.status).toBeLessThan(500);
    expect(await snapshot()).toEqual(before);
  });
});

describe('workspace export and import', () => {
  it('exports only the key workspace', async () => {
    for (const query of ['', `&workspace_id=${B.workspaceId}`]) {
      const res = await workspaceExport(
        req('GET', `/api/workspace/export?format=json${query}`, { token: A.key }),
      );
      expect(res.status).toBeLessThan(500);
      expect(await res.text()).not.toContain(MARK);
    }
  });

  it('refuses a session export and import of B', async () => {
    session.client = await signIn(A);
    const own = await workspaceExport(
      req('GET', `/api/workspace/export?format=json&workspace_id=${A.workspaceId}`),
    );
    expect(own.status).toBe(200);
    const doc = await own.text();
    const exportB = await workspaceExport(
      req('GET', `/api/workspace/export?format=json&workspace_id=${B.workspaceId}`),
    );
    expect(exportB.status).toBe(403);
    expect(await exportB.text()).not.toContain(MARK);

    const importB = await workspaceImport(
      req('POST', `/api/workspace/import?workspace_id=${B.workspaceId}&mode=overwrite`, {
        body: doc,
      }),
    );
    expect(importB.status).toBe(403);
    const byKey = await workspaceImport(
      req('POST', `/api/workspace/import?workspace_id=${B.workspaceId}&mode=overwrite`, {
        token: A.key,
        body: doc,
      }),
    );
    expect(byKey.status).toBeLessThan(500);
    expect(await snapshot()).toEqual(before);
  });
});

describe('embed token route', () => {
  it('refuses a token for a workspace the user is not a member of', async () => {
    const res = await embedToken(
      req('POST', `/api/embed/token?workspace_id=${B.workspaceId}`, { userId: A.userId }),
    );
    expect(res.status).toBe(403);
  });

  it('mints a token for the user own workspace that v1 keeps there', async () => {
    const res = await embedToken(
      req('POST', `/api/embed/token?workspace_id=${A.workspaceId}`, { userId: A.userId }),
    );
    expect(res.status).toBe(200);
    const { token } = await res.json();
    const verified = await verifyHostJwt(token, {
      secret: JWT_SECRET,
      issuer: process.env.CELUNE_HOST_JWT_ISSUER?.trim() || undefined,
      audience: process.env.CELUNE_HOST_JWT_AUDIENCE?.trim() || undefined,
    });
    expect(verified.ok && verified.auth.workspaceId).toBe(A.workspaceId);

    const read = await v1.GET(req('GET', `/api/v1/tasks/${b.task}`, { token }));
    expect(read.status).toBe(404);
    const across = await v1.GET(
      req('GET', `/api/v1/tasks?workspace_id=${B.workspaceId}`, { token }),
    );
    expect(across.status).toBe(403);
    const patch = await v1.PATCH(
      req('PATCH', `/api/v1/tasks/${b.task}`, { token, body: JSON.stringify({ title: 'x' }) }),
    );
    expect(patch.status).toBe(404);
    const mcp = await v1.POST(
      req('POST', '/api/v1/mcp', {
        token,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(mcp.status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
});

describe('platform /api/v1 host', () => {
  it('refuses workspace_id=B for an A key and hides B rows', async () => {
    const across = await v1.GET(
      req('GET', `/api/v1/tasks?workspace_id=${B.workspaceId}`, { token: A.key }),
    );
    expect(across.status).toBe(403);
    const read = await v1.GET(req('GET', `/api/v1/tasks/${b.task}`, { token: A.key }));
    expect(read.status).toBe(404);
    const project = await v1.GET(req('GET', `/api/v1/projects/${b.project}`, { token: A.key }));
    expect(project.status).toBe(404);
    const list = await v1.GET(req('GET', '/api/v1/tasks', { token: A.key }));
    expect(await list.text()).not.toContain(MARK);
  });

  it('keeps the platform memory tools to the key workspace', async () => {
    let id = 1;
    const tool = async (name: string, args: Record<string, unknown>) => {
      const res = await v1.POST(
        req('POST', '/api/v1/mcp', {
          token: A.key,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: id++,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        }),
      );
      return { status: res.status, text: await res.text() };
    };
    for (const [name, args] of [
      ['list_memories', {}],
      ['list_memories', { workspace_id: B.workspaceId }],
      ['recall_memory', { query: MARK }],
      ['recall_memory', { query: MARK, workspace_id: B.workspaceId }],
      ['whoami', {}],
      ['get_task', { task_id: b.task }],
      ['get_task', { task_id: b.task, workspace_id: B.workspaceId }],
    ] as const) {
      const reply = await tool(name, args);
      expect(reply.status, name).toBeLessThan(500);
      expect(reply.text, `${name} ${JSON.stringify(args)}`).not.toContain(`content ${MARK}`);
      expect(reply.text, `${name} ${JSON.stringify(args)}`).not.toContain(`T ${MARK}`);
    }
    await tool('store_memory', {
      key: `memory-${MARK}`,
      content: 'overwritten by A',
      workspace_id: B.workspaceId,
    });
    expect(await snapshot()).toEqual(before);
  });
});
