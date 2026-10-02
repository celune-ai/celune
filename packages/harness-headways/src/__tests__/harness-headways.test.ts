import { createTestApi, TEST_JWT_SECRET, type TestApi } from '@celuneai/api/testing';
import { verifyHostJwt } from '@celuneai/api';
import { createScope, type HarnessRunContext, type HarnessTaskInput } from '@celuneai/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentMapFromEnv,
  CeluneEventReporter,
  CeluneReportError,
  celuneMcpConnector,
  HeadwaysClient,
  RUN_NOT_FOUND,
  eventIdFor,
  HeadwaysHarness,
  HeadwaysRunWatcher,
  mintAgentServerToken,
  parseAgentMap,
  toHarnessRunStatus,
  type FetchLike,
} from '../index.ts';
import { FakeHeadways } from './fake-headways.ts';

const WS = '11111111-1111-4111-8111-111111111111';
const scope = createScope({ workspaceId: WS });
const OWNER_KEY = 'hw_owner_key';
const ASSIGNER_KEY = 'hw_assigner_key';
const PROFILES = {
  'hw-builder': { model: 'claude-sonnet-4-6', budgetUsdMax: 2 },
};

let api: TestApi;
let headways: FakeHeadways;
let watcher: HeadwaysRunWatcher;
let harness: HeadwaysHarness;
let apiKey: string;
let clock = 0;
const now = () => new Date(Date.UTC(2026, 8, 27, 12, 0, clock++));

/** Event ids the reporters posted, across watcher restarts. */
let posted: string[] = [];

/** Routes the reporter's HTTP calls into the in-process Celune API. */
const celuneFetch = (): FetchLike => async (input, init) => {
  const url = new URL(input);
  if (url.pathname === '/v1/harness/events' && typeof init?.body === 'string') {
    posted.push(JSON.parse(init.body).event_id);
  }
  return api.app.request(`${url.pathname}${url.search}`, init);
};

function setup(options: { assignerEmail?: string | null } = {}) {
  const reporter = new CeluneEventReporter({
    apiUrl: 'http://celune.test',
    workspaceId: WS,
    subject: 'user-1',
    jwt: { secret: TEST_JWT_SECRET },
    fetch: celuneFetch(),
  });
  watcher = new HeadwaysRunWatcher({ harness: 'headways', reporter, clock: now });
  harness = new HeadwaysHarness({
    apiUrl: 'http://headways.test',
    webUrl: 'http://app.headways.test',
    orgSlug: 'acme',
    apiKey: OWNER_KEY,
    userKeys: { 'assigner@example.com': ASSIGNER_KEY },
    resolveOwnerEmail: async () => options.assignerEmail ?? null,
    profiles: PROFILES,
    watcher,
    fetch: headways.fetch,
    clock: now,
  });
  api.services.harness.registry.register(WS, harness, {
    agents: { rick: 'hw-builder' },
    replace: true,
  });
}

async function claim(title = 'Write the onboarding email', description = 'Two paragraphs.') {
  const seeded = api.store.seedTask(scope, { title, description, status: 'planning' });
  const res = await api.request(`/tasks/${seeded.id}/claim`, {
    method: 'POST',
    body: JSON.stringify({ agent_id: 'rick' }),
    token: apiKey,
  });
  expect(res.status).toBe(200);
  const task = await res.json();
  return { taskId: seeded.id as string, runId: task.metadata.harness_run.run_id as string, task };
}

async function taskOf(taskId: string) {
  return api.store.tasks.get(scope, taskId);
}

beforeEach(async () => {
  clock = 0;
  posted = [];
  api = await createTestApi({ basePath: '/v1' });
  apiKey = (await api.addKey({ workspaceId: WS, userId: 'user-1' })).raw;
  headways = new FakeHeadways();
  setup();
});

describe('status mapping', () => {
  it('maps every AgentRun status onto the harness contract', () => {
    expect(
      [
        'queued',
        'running',
        'awaiting_input',
        'completed',
        'cancelled',
        'failed',
        'budget_exceeded',
        'timeout',
      ].map(toHarnessRunStatus),
    ).toEqual([
      'queued',
      'running',
      'waiting',
      'succeeded',
      'cancelled',
      'failed',
      'budget_exceeded',
      'timed_out',
    ]);
    expect(toHarnessRunStatus('something_new')).toBe('queued');
  });

  it('builds stable event ids per transition', () => {
    expect(eventIdFor('r1', 'running')).toBe('r1:dispatch');
    expect(eventIdFor('r1', 'running', 2)).toBe('r1:dispatch:2');
    expect(eventIdFor('r1', 'succeeded')).toBe('r1:finalize');
    expect(eventIdFor('r1', 'failed')).toBe('r1:fail');
    expect(eventIdFor('r1', 'cancelled')).toBe('cancel:r1');
  });
});

describe('startRun', () => {
  it('creates a Workstream, a group thread, the brief, and an AgentRun', async () => {
    const { runId, task } = await claim();
    const paths = headways.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toEqual([
      'POST /v1/workspace/workstreams',
      expect.stringMatching(/^POST \/v1\/workspace\/workstreams\/ws\d+\/threads$/),
      expect.stringMatching(/^POST \/v1\/workspace\/threads\/th\d+\/messages$/),
      expect.stringMatching(/^POST \/v1\/workspace\/workstreams\/ws\d+\/runs$/),
    ]);
    const [ws, thread, message, run] = headways.calls;
    expect(ws!.body).toMatchObject({
      goal: 'Write the onboarding email\n\nTwo paragraphs.',
      kind: 'user_initiated',
    });
    expect(thread!.body).toMatchObject({ type: 'group' });
    expect(message!.body).toMatchObject({ mentionsAgent: false });
    expect(String(message!.body!.content)).toContain('mcp__celune get_task');
    expect(run!.body).toMatchObject({ model: 'claude-sonnet-4-6', budgetUsdMax: 2 });
    expect(run!.body!.triggeringMessageId).toMatch(/^msg\d+$/);
    expect(headways.calls.every((c) => c.org === 'acme' && c.apiKey === OWNER_KEY)).toBe(true);

    expect(task.status).toBe('in_progress');
    expect(task.metadata.harness_run).toMatchObject({
      harness: 'headways',
      run_id: runId,
      harness_agent: 'hw-builder',
      status: 'queued',
      url: expect.stringMatching(/^http:\/\/app\.headways\.test\/workstreams\/ws\d+$/),
    });
    expect(watcher.tracked()).toEqual([runId]);
  });

  it('creates the Workstream as the assigner when their key is known', async () => {
    setup({ assignerEmail: 'Assigner@Example.com' });
    await claim();
    expect(headways.calls.every((c) => c.apiKey === ASSIGNER_KEY)).toBe(true);
  });

  it('reuses the Workstream for a second run of the same task', async () => {
    const { taskId, runId } = await claim();
    headways.setStatus(runId, { status: 'cancelled', endedAt: now().toISOString() });
    await watcher.pollOnce();
    expect((await taskOf(taskId)).status).toBe('planning');

    const res = await api.request(`/tasks/${taskId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'rick' }),
      token: apiKey,
    });
    expect(res.status).toBe(200);
    const created = headways.calls.filter((c) => c.path === '/v1/workspace/workstreams');
    expect(created).toHaveLength(1);
    expect(headways.runs.size).toBe(2);
  });

  it('blocks the task when Headways refuses the run', async () => {
    headways.failNext = { path: /\/runs$/, status: 409 };
    const seeded = api.store.seedTask(scope, { title: 'Archived', status: 'planning' });
    const res = await api.request(`/tasks/${seeded.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'rick' }),
      token: apiKey,
    });
    expect(res.status).toBe(200);
    const task = await taskOf(seeded.id);
    expect((task.metadata as Record<string, any>).blocked_reason).toMatch(
      /^Harness start failed: Headways POST .* 409/,
    );
  });

  it('refuses a harness agent with no profile', async () => {
    const task: HarnessTaskInput = {
      id: 't1',
      title: 'x',
      description: null,
      priority: '2',
      projectId: null,
      workspaceId: WS,
      orgId: null,
    };
    const context = {
      scope,
      agentId: 'rick',
      harnessAgentId: 'missing',
      actor: { source: 'test' },
    };
    await expect(harness.startRun(task, context as HarnessRunContext)).rejects.toThrow(
      /No Headways run profile/,
    );
  });
});

describe('run events reach the task', () => {
  it('moves the task to review with the narration as outcome', async () => {
    const { taskId, runId } = await claim();
    expect(await watcher.pollOnce()).toEqual([]); // row not written yet

    headways.setStatus(runId, { status: 'running', startedAt: now().toISOString() });
    const [dispatch] = await watcher.pollOnce();
    expect(dispatch).toMatchObject({ eventId: `${runId}:dispatch`, status: 'running' });
    expect((await taskOf(taskId)).status).toBe('in_progress');

    headways.setStatus(runId, {
      status: 'completed',
      endedAt: now().toISOString(),
      narration: 'Drafted the email and posted it as a comment.',
      tokensInput: 1200,
      tokensOutput: 300,
      costUsd: 0.04,
    });
    const [finalize] = await watcher.pollOnce();
    expect(finalize).toMatchObject({ eventId: `${runId}:finalize`, status: 'succeeded' });

    const task = await taskOf(taskId);
    expect(task.status).toBe('review');
    expect(task.outcome).toBe('Drafted the email and posted it as a comment.');
    expect((task.metadata as Record<string, any>).harness_run.status).toBe('succeeded');
    expect(watcher.tracked()).toEqual([]);
  });

  it('leaves the task in progress with run_failed on budget_exceeded', async () => {
    const { taskId, runId } = await claim();
    headways.setStatus(runId, { status: 'running', startedAt: now().toISOString() });
    await watcher.pollOnce();
    headways.setStatus(runId, {
      status: 'budget_exceeded',
      endedAt: now().toISOString(),
      costUsd: 2,
    });
    await watcher.pollOnce();

    const task = await taskOf(taskId);
    expect(task.status).toBe('in_progress');
    expect((task.metadata as Record<string, any>).blocked_reason).toBe(
      'Run stopped: budget exceeded',
    );
    expect((task.metadata as Record<string, any>).action_state).toBe('run_failed');
  });

  it('sets open_question while the run waits for input, then clears it', async () => {
    const { taskId, runId } = await claim();
    headways.setStatus(runId, { status: 'running', startedAt: now().toISOString() });
    await watcher.pollOnce();
    headways.setStatus(runId, { status: 'awaiting_input' });
    await watcher.pollOnce();
    expect(((await taskOf(taskId)).metadata as Record<string, any>).action_state).toBe(
      'open_question',
    );

    headways.setStatus(runId, { status: 'running' });
    const [again] = await watcher.pollOnce();
    expect(again!.eventId).toBe(`${runId}:dispatch:2`);
    expect(
      ((await taskOf(taskId)).metadata as Record<string, any>).action_state ?? null,
    ).toBeNull();
  });

  it('reports a replayed event as a duplicate', async () => {
    const { runId, taskId } = await claim();
    const reporter = new CeluneEventReporter({
      apiUrl: 'http://celune.test',
      workspaceId: WS,
      subject: 'user-1',
      jwt: { secret: TEST_JWT_SECRET },
      fetch: celuneFetch(),
    });
    const event = {
      eventId: `${runId}:dispatch`,
      taskId,
      harness: 'headways',
      runId,
      status: 'running' as const,
      occurredAt: now().toISOString(),
    };
    expect((await reporter.report(event)).applied).toBe(true);
    expect(await reporter.report(event)).toMatchObject({ applied: false, duplicate: true });
  });

  it('carries the failure reason on a failed run', async () => {
    const { taskId, runId } = await claim();
    headways.setStatus(runId, {
      status: 'failed',
      endedAt: now().toISOString(),
      failureReason: 'sandbox provision failed',
    });
    await watcher.pollOnce();
    expect(((await taskOf(taskId)).metadata as Record<string, any>).blocked_reason).toBe(
      'Run failed: sandbox provision failed',
    );
  });
});

describe('watcher resume after a restart', () => {
  /** A new sidecar process: fresh reporter, watcher, and harness against the same Celune and Headways. */
  function restart() {
    watcher.stop();
    setup();
    expect(watcher.tracked()).toEqual([]);
  }

  it('resumes a run mid-flight and reports completion exactly once', async () => {
    const { taskId, runId } = await claim();
    headways.setStatus(runId, { status: 'running', startedAt: now().toISOString() });
    await watcher.pollOnce();

    restart();
    expect(await watcher.resync()).toEqual([]);
    expect(watcher.tracked()).toEqual([runId]);

    headways.setStatus(runId, {
      status: 'completed',
      endedAt: now().toISOString(),
      narration: 'Done after the restart.',
    });
    const [finalize] = await watcher.pollOnce();
    expect(finalize).toMatchObject({ eventId: `${runId}:finalize`, status: 'succeeded' });
    expect(await watcher.pollOnce()).toEqual([]);
    expect(await watcher.resync()).toEqual([]);

    expect(posted.filter((id) => id === `${runId}:finalize`)).toHaveLength(1);
    const task = await taskOf(taskId);
    expect(task.status).toBe('review');
    expect(task.outcome).toBe('Done after the restart.');
  });

  it('reports a run that ended while no watcher ran, once', async () => {
    const { taskId, runId } = await claim();
    headways.setStatus(runId, { status: 'running', startedAt: now().toISOString() });
    await watcher.pollOnce();

    restart();
    headways.setStatus(runId, { status: 'failed', failureReason: 'Sandbox lost' });
    const sent = await watcher.resync();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ eventId: `${runId}:fail`, status: 'failed' });
    expect(watcher.tracked()).toEqual([]);

    // A second sidecar that restarts now finds nothing active to report.
    restart();
    expect(await watcher.resync()).toEqual([]);
    expect(posted.filter((id) => id === `${runId}:fail`)).toHaveLength(1);
    expect((await taskOf(taskId)).metadata as Record<string, any>).toMatchObject({
      harness_run: { status: 'failed' },
    });
  });

  it('continues repeat counters from the event ids Celune applied', async () => {
    const { runId } = await claim();
    headways.setStatus(runId, { status: 'running', startedAt: now().toISOString() });
    await watcher.pollOnce();
    headways.setStatus(runId, { status: 'awaiting_input' });
    await watcher.pollOnce();

    restart();
    headways.setStatus(runId, { status: 'running' });
    const [again] = await watcher.resync();
    expect(again).toMatchObject({ eventId: `${runId}:dispatch:2`, status: 'running' });
    expect(posted).toEqual([`${runId}:dispatch`, `${runId}:park-awaiting`, `${runId}:dispatch:2`]);
  });

  it('resumes tracking from Celune when started', async () => {
    const { runId } = await claim();
    restart();
    watcher.start({ intervalMs: 60_000, resyncMs: 0 });
    await vi.waitFor(() => expect(watcher.tracked()).toEqual([runId]));
    watcher.stop();
  });

  it('reads and reports a resumed run with the key of the user it was started as', async () => {
    setup({ assignerEmail: 'Assigner@Example.com' });
    const { taskId, runId, task } = await claim();
    expect(task.metadata.harness_run.run_as).toBe('assigner@example.com');
    headways.setStatus(runId, { status: 'running', startedAt: now().toISOString() });

    restart();
    headways.setStatus(runId, { status: 'completed', narration: 'Done as the assigner.' });
    const [finalize] = await watcher.resync();
    expect(finalize).toMatchObject({ eventId: `${runId}:finalize`, status: 'succeeded' });
    const reads = headways.calls.filter((c) => c.method === 'GET' && c.path.endsWith(runId));
    expect(reads.at(-1)?.apiKey).toBe(ASSIGNER_KEY);
    expect((await taskOf(taskId)).status).toBe('review');
  });

  it('cancels a resumed run with the key of the user it was started as', async () => {
    setup({ assignerEmail: 'assigner@example.com' });
    const { runId } = await claim();
    headways.setStatus(runId, { status: 'running', startedAt: now().toISOString() });
    restart();
    await watcher.resync();
    await harness.cancelRun({ harness: 'headways', runId });
    const cancel = headways.calls.find(
      (c) => c.method === 'POST' && c.path.endsWith(`${runId}/cancel`),
    );
    expect(cancel?.apiKey).toBe(ASSIGNER_KEY);
  });

  it('keeps the org owner key for runs started without a user key', async () => {
    const { runId, task } = await claim();
    expect(task.metadata.harness_run.run_as).toBeUndefined();
    restart();
    await watcher.resync();
    const reads = headways.calls.filter((c) => c.method === 'GET' && c.path.endsWith(runId));
    expect(reads.at(-1)?.apiKey).toBe(OWNER_KEY);
  });
});

describe('heartbeat and cancel', () => {
  it('reads queued while the AgentRun row does not exist yet', async () => {
    const { runId } = await claim();
    expect((await harness.heartbeat({ harness: 'headways', runId })).status).toBe('queued');
    headways.setStatus(runId, { status: 'running', costUsd: 0.5 });
    const beat = await harness.heartbeat({ harness: 'headways', runId });
    expect(beat).toMatchObject({ status: 'running', progress: { cost_usd: 0.5 } });
  });

  it('cancels in Headways, returns the task to planning, and stops watching', async () => {
    const { taskId, runId } = await claim();
    const result = await api.services.harness.cancel(scope, taskId, { source: 'test' });
    expect(result.task.status).toBe('planning');
    expect(headways.runs.get(runId)!.status).toBe('cancelled');
    expect(headways.calls.at(-1)).toMatchObject({
      method: 'POST',
      path: `/v1/workspace/runs/${runId}/cancel`,
      body: { clientRequestId: `cancel:${runId}` },
    });
    expect(watcher.tracked()).toEqual([]);
  });
});

describe('watcher failure handling', () => {
  it('reports a run Headways no longer has as failed after three misses', async () => {
    const { taskId, runId } = await claim();
    headways.setStatus(runId, { status: 'running', startedAt: now().toISOString() });
    await watcher.pollOnce();
    headways.runs.delete(runId);

    expect(await watcher.pollOnce()).toEqual([]);
    expect(await watcher.pollOnce()).toEqual([]);
    const [failed] = await watcher.pollOnce();
    expect(failed).toMatchObject({
      eventId: `${runId}:fail`,
      status: 'failed',
      error: RUN_NOT_FOUND,
    });
    expect(watcher.tracked()).toEqual([]);
    expect((await taskOf(taskId)).metadata as Record<string, any>).toMatchObject({
      harness_run: { status: 'failed' },
    });
  });

  /** A watcher on a hand-set clock whose run always reads `running` and whose reports Celune refuses. */
  function refusedWatcher(status: number) {
    let at = 0;
    const errors: unknown[] = [];
    const reports: string[] = [];
    const client = {
      getRun: async (id: string) => ({ id, status: 'running', endedAt: null }),
    } as unknown as HeadwaysClient;
    const w = new HeadwaysRunWatcher({
      harness: 'headways',
      clock: () => new Date(at),
      reporter: {
        report: async (event) => {
          reports.push(event.eventId);
          throw new CeluneReportError(status, `refused ${status}`);
        },
        listActiveRuns: async () => [],
      },
      onError: (error) => errors.push(error),
    });
    w.track('run-x', 'task-x', client);
    return { w, errors, reports, advance: (ms: number) => (at += ms) };
  }

  it('backs off a failing run exponentially', async () => {
    const { w, reports, advance } = refusedWatcher(503);
    await w.pollOnce();
    expect(reports).toHaveLength(1);
    advance(4_999);
    await w.pollOnce();
    expect(reports).toHaveLength(1);
    advance(1);
    await w.pollOnce();
    expect(reports).toHaveLength(2);
    advance(9_999);
    await w.pollOnce();
    expect(reports).toHaveLength(2);
    advance(1);
    await w.pollOnce();
    expect(reports).toHaveLength(3);
    expect(w.tracked()).toEqual(['run-x']);
  });

  it('drops a run after repeated permanent refusals, and retries 429', async () => {
    const refused = refusedWatcher(400);
    for (let i = 0; i < 3; i++) {
      await refused.w.pollOnce();
      refused.advance(600_000);
    }
    expect(refused.w.tracked()).toEqual([]);
    expect(String(refused.errors.at(-1))).toMatch(/Stopped watching run run-x/);

    const limited = refusedWatcher(429);
    for (let i = 0; i < 5; i++) {
      await limited.w.pollOnce();
      limited.advance(600_000);
    }
    expect(limited.w.tracked()).toEqual(['run-x']);
  });

  it('leaves a run alone while its cancel is in flight', async () => {
    const { runId } = await claim();
    watcher.stop();
    setup();
    const settle = watcher.beginCancel(runId);
    await watcher.resync();
    expect(watcher.tracked()).toEqual([]);
    settle();
    await watcher.resync();
    expect(watcher.tracked()).toEqual([runId]);
  });
});

describe('request timeouts', () => {
  /** A server that accepts the request and never answers. */
  const hangingFetch: FetchLike = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });

  it('gives up on a hung Headways call', async () => {
    const client = new HeadwaysClient({
      apiUrl: 'http://headways.test',
      apiKey: OWNER_KEY,
      orgSlug: 'acme',
      fetch: hangingFetch,
      timeoutMs: 20,
    });
    await expect(client.getRun('run-1')).rejects.toThrow(/timeout|aborted/i);
  });

  it('gives up on a hung Celune call', async () => {
    const reporter = new CeluneEventReporter({
      apiUrl: 'http://celune.test',
      workspaceId: WS,
      subject: 'user-1',
      jwt: { secret: TEST_JWT_SECRET },
      fetch: hangingFetch,
      timeoutMs: 20,
    });
    await expect(reporter.listActiveRuns('headways')).rejects.toThrow(/timeout|aborted/i);
  });
});

describe('server tokens and the MCP connector', () => {
  it('signs reporter and agent tokens with write scope and no permissions', async () => {
    const token = await mintAgentServerToken(
      { agentId: 'rick', workspaceId: WS },
      { secret: TEST_JWT_SECRET },
    );
    const verified = await verifyHostJwt(token, { secret: TEST_JWT_SECRET });
    expect(verified.ok && verified.auth).toMatchObject({
      principal: 'jwt',
      userId: 'rick',
      workspaceId: WS,
      scopes: ['write'],
    });
    expect(verified.ok && 'permissions' in verified.auth).toBe(false);
  });

  it('lets the agent token list tools on /v1/mcp', async () => {
    const token = await mintAgentServerToken(
      { agentId: 'rick', workspaceId: WS },
      { secret: TEST_JWT_SECRET },
    );
    const res = await api.request('/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      token,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('get_task');
  });

  it('describes the Celune MCP as a remote_mcp connector', () => {
    expect(celuneMcpConnector({ celuneApiUrl: 'https://celune.internal/' })).toEqual({
      key: 'celune',
      displayName: 'Celune',
      integrationType: 'remote_mcp',
      authType: 'api-key',
      configTemplate: { type: 'http', url: 'https://celune.internal/v1/mcp' },
    });
  });

  it('refuses a short signing secret', async () => {
    await expect(
      mintAgentServerToken({ agentId: 'rick', workspaceId: WS }, { secret: 'short' }),
    ).rejects.toThrow(/at least 32 bytes/);
  });
});

describe('agent map config', () => {
  it('reads an inline agent map', () => {
    const map = agentMapFromEnv({
      CELUNE_HEADWAYS_AGENT_MAP: JSON.stringify({
        agents: { rick: 'hw-builder' },
        profiles: PROFILES,
      }),
    });
    expect(map.agents.rick).toBe('hw-builder');
  });

  it('rejects a mapped agent without a profile', () => {
    expect(() => parseAgentMap({ agents: { rick: 'nope' }, profiles: {} })).toThrow(
      /needs a profile/,
    );
    expect(() => agentMapFromEnv({})).toThrow(/CELUNE_HEADWAYS_AGENT_MAP/);
  });
});
