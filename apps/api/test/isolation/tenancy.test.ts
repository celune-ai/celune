/**
 * Two workspaces on a real Supabase stack. Workspace B holds data; workspace
 * A's principals (an admin API key, a server JWT, and an embed JWT) try to
 * read and change it through every route the standalone v1 server registers,
 * through MCP, through the Supabase store directly, and through PostgREST with
 * RLS as a signed-in user and as anon. Every attempt must be refused, and B's
 * rows are checked afterwards against the service-role view.
 */
import { HarnessRegistry, LoopbackHarness, type HarnessRunMarker } from '@celuneai/core';
import { SupabaseStore } from '@celuneai/core/supabase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.ts';
import {
  RUN,
  admin,
  anonClient,
  createTenant,
  dropTenant,
  requester,
  rpcReply,
  signedInClient,
  type Reply,
  type Tenant,
} from './stack.ts';

const MARK = `bmark-${RUN}`;
// No MARK in the name: A may write its own row under the same agent name, and B rows carry B.workspaceId.
const B_AGENT = `agent-b-${RUN}`;
/** An agent_status row with no workspace, which older RLS policies showed to every caller. */
const NULL_AGENT = `agent-null-${MARK}`;

let A: Tenant;
let B: Tenant;
let app: ReturnType<typeof buildServer>;
let call: ReturnType<typeof requester>;
let store: SupabaseStore;

/** Ids of everything seeded in workspace B. */
const b = {
  project: '',
  task: '',
  runTask: '',
  comment: '',
  attachment: '',
  extJob: '',
  srvJob: '',
  runId: '',
  eventId: `evt-${MARK}`,
};
let aTask = '';

function ok(reply: Reply, label: string): Reply {
  if (reply.status >= 300) {
    throw new Error(`${label} answered ${reply.status}: ${JSON.stringify(reply.json)}`);
  }
  return reply;
}

function bIds(): string[] {
  return [b.project, b.task, b.runTask, b.comment, b.attachment, b.extJob, b.srvJob, B.workspaceId];
}

/** True when a body carries nothing seeded in B: no B content and no B ids. */
function leaksNothing(json: unknown): boolean {
  const text = JSON.stringify(json ?? null);
  return !text.includes(MARK) && bIds().every((id) => !text.includes(id));
}

/** Error bodies may echo the id the caller sent; they still must carry no B content. */
function leaksNoContent(json: unknown): boolean {
  return !JSON.stringify(json ?? null).includes(MARK);
}

/** Every B row the suite seeded, read with the service role. */
async function snapshot() {
  const byIds = async (table: string, column: string, ids: string[]) => {
    const { data, error } = await admin.from(table).select('*').in(column, ids).order('id');
    if (error) throw new Error(`${table} snapshot: ${error.message}`);
    return data;
  };
  // Tables differ in timestamp columns, so sort by row content for a stable before/after compare.
  const inB = async (table: string) => {
    const { data, error } = await admin.from(table).select('*').eq('workspace_id', B.workspaceId);
    if (error) throw new Error(`${table} snapshot: ${error.message}`);
    return [...(data ?? [])].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  };
  return {
    tasks: await inB('tasks'),
    projects: await inB('projects'),
    comments: await byIds('task_comments', 'task_id', [b.task, b.runTask]),
    attachments: await byIds('task_attachments', 'task_id', [b.task, b.runTask]),
    jobs: await inB('ai_job_queue'),
    jobLogs: await byIds('job_logs', 'job_id', [b.extJob, b.srvJob]),
    agents: await inB('agent_status'),
    connection: await inB('harness_connections'),
    ledger: await inB('harness_event_ledger'),
    activity: await inB('activity_log'),
  };
}
let before: Awaited<ReturnType<typeof snapshot>>;

beforeAll(async () => {
  const { error: bucketError } = await admin.storage.createBucket('task-attachments', {
    public: false,
  });
  if (bucketError && !/exist/i.test(bucketError.message)) {
    throw new Error(`bucket: ${bucketError.message}`);
  }

  const registry = new HarnessRegistry({ factories: { loopback: () => new LoopbackHarness() } });
  app = buildServer({ harnessRegistry: registry });
  call = requester((request) => app.fetch(request), '/v1');
  store = new SupabaseStore(admin);

  [A, B] = [await createTenant('a'), await createTenant('b')];

  const project = ok(await call(B.adminKey, 'POST', '/projects', { name: `P ${MARK}` }), 'project');
  b.project = project.json.id;
  const task = ok(
    await call(B.adminKey, 'POST', '/tasks', {
      title: `T ${MARK}`,
      project_id: b.project,
      status: 'planning',
    }),
    'task',
  );
  b.task = task.json.id;
  const runTask = ok(
    await call(B.adminKey, 'POST', '/tasks', { title: `R ${MARK}`, status: 'planning' }),
    'run task',
  );
  b.runTask = runTask.json.id;
  const comment = ok(
    await call(B.adminKey, 'POST', `/tasks/${b.task}/comments`, { content: `C ${MARK}` }),
    'comment',
  );
  b.comment = comment.json.id;
  const form = new FormData();
  form.append('files', new File([`bytes ${MARK}`], `${MARK}.txt`, { type: 'text/plain' }));
  const attachment = ok(
    await call(B.adminKey, 'POST', `/tasks/${b.task}/attachments`, form),
    'attachment',
  );
  b.attachment = attachment.json.attachments[0].id;
  ok(
    await call(B.adminKey, 'PUT', `/agents/${B_AGENT}/status`, { status: 'working' }),
    'agent status',
  );
  ok(
    await call(B.adminKey, 'PUT', '/harness/connection', {
      harness: 'loopback',
      agents: { rick: `hw-${MARK}` },
      config: { label: MARK },
    }),
    'harness connection',
  );
  const claimed = ok(
    await call(B.adminKey, 'POST', `/tasks/${b.runTask}/claim`, { agent_id: 'rick' }),
    'claim',
  );
  b.runId = claimed.json.metadata.harness_run.run_id;
  ok(
    await call(B.serverJwt, 'POST', '/harness/events', {
      event_id: b.eventId,
      task_id: b.runTask,
      harness: 'loopback',
      run_id: b.runId,
      status: 'running',
      occurred_at: new Date().toISOString(),
    }),
    'harness event',
  );

  const job = (runner: 'external' | 'server') => ({
    workspace_id: B.workspaceId,
    org_id: B.orgId,
    requester_id: B.userId,
    job_type: 'chat',
    job_hmac: `hmac-${MARK}`,
    runner,
    ...(runner === 'server' ? { target_type: 'task', target_id: b.task } : {}),
    metadata: { mark: MARK },
  });
  const { data: jobs, error: jobError } = await admin
    .from('ai_job_queue')
    .insert([job('external'), job('server')])
    .select('id, runner');
  if (jobError || !jobs) throw new Error(`jobs: ${jobError?.message}`);
  b.extJob = jobs.find((j) => j.runner === 'external')!.id;
  b.srvJob = jobs.find((j) => j.runner === 'server')!.id;
  await store.jobs.appendLog(B.scope, {
    job_id: b.extJob,
    step_index: 0,
    event_type: 'message',
    content: MARK,
  });

  const own = ok(
    await call(A.adminKey, 'POST', '/tasks', { title: 'A own task', status: 'planning' }),
    'A task',
  );
  aTask = own.json.id;
  const { error: nullAgentError } = await admin
    .from('agent_status')
    .insert({ agent_name: NULL_AGENT, status: 'online', workspace_id: null, user_id: null });
  if (nullAgentError) throw new Error(`null agent: ${nullAgentError.message}`);
  before = await snapshot();
});

afterAll(async () => {
  await admin.from('agent_status').delete().eq('agent_name', NULL_AGENT);
  await dropTenant(A);
  await dropTenant(B);
});

const principals = () =>
  [
    ['admin API key', A.adminKey],
    ['server JWT', A.serverJwt],
    ['embed JWT', A.embedJwt],
  ] as const;

/** Every authenticated route the standalone server registers, with B's ids in place of params. */
function concreteRoutes(): Array<{ method: string; path: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ method: string; path: string; label: string }> = [];
  for (const route of app.routes) {
    if (route.method === 'ALL' || !route.path.startsWith('/v1/') || route.path === '/v1/health') {
      continue;
    }
    const label = `${route.method} ${route.path}`;
    if (seen.has(label)) continue;
    seen.add(label);
    const idFor: Record<string, string> = { tasks: b.task, projects: b.project, jobs: b.extJob };
    const path = route.path
      .slice('/v1'.length)
      .replace(':id', idFor[route.path.split('/')[2]] ?? 'unmapped')
      .replace(':attachmentId', b.attachment)
      .replace(':name', B_AGENT);
    out.push({ method: route.method, path, label });
  }
  return out;
}

function bodyFor(method: string, path: string): unknown {
  if (method === 'GET' || method === 'DELETE') return undefined;
  if (path.endsWith('/attachments')) {
    const form = new FormData();
    form.append('files', new File(['x'], 'x.txt', { type: 'text/plain' }));
    return form;
  }
  if (path.endsWith('/comments')) return { content: 'from A' };
  if (path.endsWith('/claim')) return path.startsWith('/jobs') ? {} : { agent_id: 'rick' };
  if (path.endsWith('/complete')) return { outcome: 'from A' };
  if (path.endsWith('/block')) return { reason: 'from A' };
  if (path.endsWith('/result')) {
    return { status: 'failed', job_hmac: `hmac-${MARK}`, nonce: 'x', error: errorBody };
  }
  if (path.endsWith('/heartbeat') && path.startsWith('/jobs')) return {};
  if (path === '/tasks/reorder') return [{ id: b.task, status: 'done', sort_order: 999 }];
  if (path === '/projects/reorder') return [{ id: b.project, sort_order: 999 }];
  if (path === '/executions/cancel') return { task_id: b.task, execution_id: b.srvJob };
  if (path === '/harness/events') {
    return {
      event_id: `evt-a-${RUN}`,
      task_id: b.runTask,
      harness: 'loopback',
      run_id: b.runId,
      status: 'succeeded',
      occurred_at: new Date().toISOString(),
    };
  }
  if (/^\/agents\/[^/]+\/status$/.test(path)) return { status: 'offline' };
  if (path.startsWith('/tasks/')) return { title: 'from A', status: 'done' };
  if (path.startsWith('/projects/')) return { name: 'from A' };
  return {};
}

const errorBody = { code: 'x', message: 'from A', retryable: false };

/** Routes whose params are not B's ids, or whose writes land in A's own workspace. */
const OWN_WORKSPACE = new Set([
  'POST /v1/tasks',
  'POST /v1/projects',
  'PUT /v1/tasks/reorder',
  'PUT /v1/projects/reorder',
  'POST /v1/agents/heartbeat',
  'PUT /v1/agents/:name/status',
  'PUT /v1/harness/connection',
  'DELETE /v1/harness/connection',
  'POST /v1/executions/cancel',
  'POST /v1/mcp',
  'DELETE /v1/mcp',
]);

describe('v1 REST, every registered route', () => {
  it('covers the route families the suite seeds', () => {
    const labels = concreteRoutes().map((r) => r.label);
    for (const family of ['tasks', 'projects', 'activity', 'agents', 'jobs', 'executions']) {
      expect(
        labels.some((l) => l.includes(`/v1/${family}`)),
        family,
      ).toBe(true);
    }
    expect(labels).toContain('POST /v1/harness/events');
    expect(labels).toContain('PUT /v1/harness/connection');
    expect(labels.length).toBeGreaterThan(35);
  });

  it.each(['admin API key', 'server JWT', 'embed JWT'])(
    '%s: B ids in the path are refused or answered with nothing of B',
    async (label) => {
      const token = principals().find(([l]) => l === label)![1];
      for (const route of concreteRoutes()) {
        const reply = await call(
          token,
          route.method,
          route.path,
          bodyFor(route.method, route.path),
        );
        expect(reply.status, `${route.label} -> ${JSON.stringify(reply.json)}`).toBeLessThan(500);
        if (reply.status >= 300) {
          expect(leaksNoContent(reply.json), route.label).toBe(true);
        } else {
          expect(leaksNothing(reply.json), route.label).toBe(true);
        }
        if (route.method === 'GET' || OWN_WORKSPACE.has(route.label)) continue;
        expect(
          reply.status,
          `${route.label} -> ${JSON.stringify(reply.json)}`,
        ).toBeGreaterThanOrEqual(400);
      }
    },
  );

  it.each(['admin API key', 'server JWT', 'embed JWT'])(
    '%s: workspace_id=B is refused on every route',
    async (label) => {
      const token = principals().find(([l]) => l === label)![1];
      for (const route of concreteRoutes()) {
        const joiner = route.path.includes('?') ? '&' : '?';
        const reply = await call(
          token,
          route.method,
          `${route.path}${joiner}workspace_id=${B.workspaceId}`,
          bodyFor(route.method, route.path),
        );
        expect(reply.status, route.label).toBe(403);
      }
    },
  );

  it('rejects references to B rows from A writes', async () => {
    const refs = [
      { title: 'x', project_id: b.project },
      { title: 'x', parent_id: b.task },
      { title: 'x', spawned_by: b.task },
      { title: 'x', depends_on: [b.task] },
    ];
    for (const body of refs) {
      const reply = await call(A.adminKey, 'POST', '/tasks', body);
      expect(reply.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      expect(reply.status).not.toBe(500);
    }
    const patch = await call(A.adminKey, 'PATCH', `/tasks/${aTask}`, { project_id: b.project });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    expect(patch.status).not.toBe(500);
  });

  it('keeps list endpoints to the caller workspace', async () => {
    const lists = [
      '/tasks',
      '/tasks?include_archived=true',
      '/tasks/count',
      '/projects',
      '/projects/progress',
      '/activity',
      `/activity?task_id=${b.task}`,
      '/agents/status',
      '/jobs',
      '/jobs?runner=server',
      '/jobs/pending',
      `/executions?task_id=${b.task}`,
      '/harness/runs?harness=loopback',
    ];
    for (const [label, token] of principals()) {
      for (const path of lists) {
        const reply = await call(token, 'GET', path);
        if (reply.status < 300) expect(leaksNothing(reply.json), `${label} ${path}`).toBe(true);
      }
    }
    const own = await call(A.adminKey, 'GET', '/tasks');
    expect(own.json.map((t: { id: string }) => t.id)).toContain(aTask);
  });

  it('refuses the MCP tools on B ids, with and without workspace_id', async () => {
    let id = 1;
    const tool = async (name: string, args: Record<string, unknown>) => {
      const reply = await call(A.adminKey, 'POST', '/mcp', {
        jsonrpc: '2.0',
        id: id++,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      return { reply, rpc: rpcReply(reply) };
    };
    const attempts: Array<[string, Record<string, unknown>]> = [
      ['get_task', { task_id: b.task }],
      ['add_comment', { task_id: b.task, content: 'from A' }],
      ['claim_task', { task_id: b.task }],
      ['complete_task', { task_id: b.task, outcome: 'from A' }],
      ['block_task', { task_id: b.task, reason: 'from A' }],
      ['get_project', { project_id: b.project }],
      ['claim_job', { job_id: b.extJob }],
      ['heartbeat', { job_id: b.extJob }],
      [
        'submit_job_result',
        { job_id: b.extJob, status: 'failed', job_hmac: 'x', nonce: 'x', content: 'x' },
      ],
    ];
    for (const [name, args] of attempts) {
      for (const scoped of [args, { ...args, workspace_id: B.workspaceId }]) {
        const { reply, rpc } = await tool(name, scoped);
        const refused =
          reply.status === 403 || rpc.error !== undefined || rpc.result?.isError === true;
        expect(refused, `${name} ${JSON.stringify(scoped)}`).toBe(true);
        expect(leaksNoContent(rpc), name).toBe(true);
      }
    }
    for (const [name, args] of [
      ['list_tasks', {}],
      ['list_projects', {}],
      ['poll_pending_jobs', {}],
      ['get_workspace_pulse', {}],
    ] as const) {
      const { rpc } = await tool(name, args);
      expect(leaksNothing(rpc), name).toBe(true);
      const across = await tool(name, { workspace_id: B.workspaceId });
      expect(leaksNoContent(across.rpc), `${name} with workspace_id`).toBe(true);
    }
    const embed = await call(A.embedJwt, 'POST', '/mcp', {
      jsonrpc: '2.0',
      id: id++,
      method: 'tools/list',
    });
    expect(embed.status).toBe(403);
  });

  it('keeps harness connections per workspace', async () => {
    const put = await call(A.adminKey, 'PUT', '/harness/connection', {
      harness: 'loopback',
      agents: { rick: 'hw-a' },
    });
    expect(put.status).toBe(200);
    const mine = await call(A.adminKey, 'GET', '/harness/connection');
    expect(mine.json.agents).toEqual({ rick: 'hw-a' });
    const theirs = await call(B.adminKey, 'GET', '/harness/connection');
    expect(theirs.json.agents).toEqual({ rick: `hw-${MARK}` });
    expect((await call(A.adminKey, 'DELETE', '/harness/connection')).status).toBe(204);
    expect((await call(B.adminKey, 'GET', '/harness/connection')).status).toBe(200);
  });
});

describe('SupabaseStore with workspace A scope', () => {
  it('refuses task, project, comment, and attachment access to B rows', async () => {
    const s = A.scope;
    await expect(store.tasks.get(s, b.task)).rejects.toMatchObject({ code: 'not_found' });
    await store.tasks.update(s, b.task, { title: 'from A' }).catch(() => undefined);
    await store.tasks.delete(s, b.task).catch(() => undefined);
    expect(await store.tasks.list(s, { ids: [b.task, b.runTask] })).toEqual([]);
    expect(await store.tasks.listChildren(s, b.task)).toEqual([]);
    expect(await store.tasks.listDependents(s, b.task)).toEqual([]);
    await store.tasks
      .reorder(s, [{ id: b.task, status: 'done', sort_order: 999 }])
      .catch(() => undefined);
    const marker: HarnessRunMarker = { runId: b.runId, lastEventId: b.eventId };
    expect(await store.tasks.replaceMetadataIfRun!(s, b.runTask, marker, {})).toBeNull();

    await expect(store.projects.get(s, b.project)).rejects.toMatchObject({ code: 'not_found' });
    await store.projects.update(s, b.project, { name: 'from A' }).catch(() => undefined);
    await store.projects.delete(s, b.project).catch(() => undefined);
    await store.projects.reorder(s, [{ id: b.project, sort_order: 999 }]).catch(() => undefined);
    expect(Object.keys(await store.projects.progress(s))).not.toContain(b.project);
    expect(leaksNothing(await store.projects.list(s))).toBe(true);

    expect(await store.comments.list(s, b.task)).toEqual([]);
    await expect(
      store.comments.add(s, { task_id: b.task, author: 'a', content: 'from A' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await store.attachments.list(s, b.task)).toEqual([]);
    await expect(
      store.attachments.add(s, {
        task_id: b.task,
        file_name: 'x',
        file_size: 1,
        mime_type: 'text/plain',
        storage_path: `${b.task}/x`,
        uploaded_by: A.userId,
        user_id: A.userId,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.attachments.remove(s, b.task, b.attachment)).rejects.toMatchObject({
      code: 'not_found',
    });

    expect((await store.activity.list(s, { task_id: b.task })).data).toEqual([]);
    expect(leaksNothing(await store.activity.list(s, { limit: 200 }))).toBe(true);
    expect(leaksNothing(await store.agents.listStatus(s))).toBe(true);
  });

  it('refuses job access to B rows', async () => {
    const s = A.scope;
    expect(await store.jobs.get(s, b.extJob)).toBeNull();
    expect(
      await store.jobs.claim(s, b.extJob, { keyId: '00000000-0000-4000-8000-000000000000' }),
    ).toBeNull();
    expect(await store.jobs.heartbeat(s, b.extJob, { workerId: 'w' }, {})).toBeNull();
    await store.jobs.update(s, b.extJob, { status: 'failed' });
    await store.jobs.submitResult(s, b.extJob, { status: 'failed' });
    expect(await store.jobs.cancel(s, b.srvJob, { status: 'cancelled' })).toBeNull();
    await store.jobs.expire(s, new Date(Date.now() + 3_600_000).toISOString());
    expect(leaksNothing(await store.jobs.list(s))).toBe(true);
    expect(
      leaksNothing(await store.jobs.listPending(s, { queueName: 'default', runner: 'external' })),
    ).toBe(true);
    expect(await store.jobs.listLogs(s, b.extJob)).toEqual([]);
    await expect(
      store.jobs.appendLog(s, { job_id: b.extJob, step_index: 9, event_type: 'message' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keys the harness ledger and connections by workspace', async () => {
    expect(await store.harnessEvents.take(B.scope, b.eventId)).toBe(false);
    expect(await store.harnessEvents.take(A.scope, b.eventId)).toBe(true);
    await store.harnessEvents.release(A.scope, b.eventId);
    expect(await store.harnessEvents.take(B.scope, b.eventId)).toBe(false);

    expect(await store.harnessConnections.get(A.scope)).toBeNull();
    expect(await store.harnessConnections.remove(A.scope)).toBe(false);
    expect((await store.harnessConnections.get(B.scope))?.config).toEqual({ label: MARK });
  });
});

describe('PostgREST with RLS', () => {
  const tables: Array<[string, string, () => string]> = [
    ['tasks', 'id', () => b.task],
    ['projects', 'id', () => b.project],
    ['task_comments', 'id', () => b.comment],
    ['task_attachments', 'id', () => b.attachment],
    ['activity_log', 'workspace_id', () => B.workspaceId],
    ['ai_job_queue', 'id', () => b.extJob],
    ['job_logs', 'job_id', () => b.extJob],
    ['agent_status', 'workspace_id', () => B.workspaceId],
    ['harness_connections', 'workspace_id', () => B.workspaceId],
    ['harness_event_ledger', 'workspace_id', () => B.workspaceId],
    ['api_keys', 'workspace_id', () => B.workspaceId],
    ['workspaces', 'id', () => B.workspaceId],
    ['workspace_memberships', 'workspace_id', () => B.workspaceId],
  ];

  it('shows a signed-in A user none of B rows', async () => {
    const client = await signedInClient(A);
    for (const [table, column, value] of tables) {
      const { data } = await client.from(table).select('*').eq(column, value());
      expect(data ?? [], table).toEqual([]);
    }
    const { data: nullAgent } = await client
      .from('agent_status')
      .select('*')
      .eq('agent_name', NULL_AGENT);
    expect(nullAgent ?? [], 'agent_status with no workspace').toEqual([]);
  });

  it('shows anon none of B rows', async () => {
    const client = anonClient();
    for (const [table, column, value] of tables) {
      const { data } = await client.from(table).select('*').eq(column, value());
      expect(data ?? [], table).toEqual([]);
    }
    const { data: nullAgent } = await client
      .from('agent_status')
      .select('*')
      .eq('agent_name', NULL_AGENT);
    expect(nullAgent ?? [], 'agent_status with no workspace').toEqual([]);
  });

  it('refuses a signed-in A user writes into B', async () => {
    const client = await signedInClient(A);
    await client.from('tasks').update({ title: 'from A rls' }).eq('id', b.task);
    await client.from('projects').update({ name: 'from A rls' }).eq('id', b.project);
    await client.from('task_comments').delete().eq('id', b.comment);
    await client.from('task_attachments').delete().eq('id', b.attachment);
    await client.from('ai_job_queue').update({ status: 'cancelled' }).eq('id', b.extJob);
    await client.from('harness_connections').delete().eq('workspace_id', B.workspaceId);
    const insert = await client
      .from('tasks')
      .insert({ title: `rls ${RUN}`, workspace_id: B.workspaceId, org_id: B.orgId })
      .select('id');
    expect(insert.data ?? []).toEqual([]);
    const { data: planted } = await admin
      .from('tasks')
      .select('id')
      .eq('workspace_id', B.workspaceId)
      .eq('title', `rls ${RUN}`);
    expect(planted ?? []).toEqual([]);
  });
});

describe('B rows after every attempt', () => {
  it('match the snapshot taken after seeding', async () => {
    const after = await snapshot();
    expect(after.tasks.length).toBe(2);
    expect(after.comments.length).toBe(1);
    expect(after.attachments.length).toBe(1);
    expect(after.jobs.length).toBe(2);
    expect(after.connection.length).toBe(1);
    expect(after).toEqual(before);
  });
});
