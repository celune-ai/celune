import type { Task } from '@repo/types';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActorContext } from '../actor.ts';
import {
  Conflict,
  GateDenied,
  InvalidTransition,
  TaskBlocked,
  Unavailable,
  ValidationError,
} from '../errors.ts';
import type { Gate } from '../gate.ts';
import {
  HarnessService,
  InMemoryHarnessLedger,
  type HarnessEventLedger,
} from '../harness/harness-service.ts';
import { LoopbackHarness } from '../harness/loopback.ts';
import { defaultRunEventMapping } from '../harness/mapping.ts';
import { HarnessRegistry } from '../harness/registry.ts';
import type { HarnessRunEvent, HarnessRunRecord, HarnessRunStatus } from '../harness/types.ts';
import { createScope } from '../scope.ts';
import { createServices } from '../services.ts';
import { TaskService } from '../tasks/task-service.ts';
import { InMemoryStore } from '../testing/memory-store.ts';

const scope = createScope({ workspaceId: 'ws-a', orgId: 'org-a', actorId: 'user-a' });
const api: ActorContext = { source: 'api', userId: 'user-a' };
const host: ActorContext = { source: 'harness', userId: 'host-user' };

let now: number;
const clock = () => new Date(now);
const tick = (ms = 1000) => {
  now += ms;
};

let store: InMemoryStore;
let tasks: TaskService;
let registry: HarnessRegistry;
let loopback: LoopbackHarness;
let service: HarnessService;

function runOf(task: Task): HarnessRunRecord {
  return (task.metadata as Record<string, unknown>).harness_run as HarnessRunRecord;
}

function meta(task: Task): Record<string, unknown> {
  return task.metadata as Record<string, unknown>;
}

async function claimed(title = 'Build the bridge') {
  const seeded = store.seedTask(scope, { title, status: 'planning' });
  const result = await service.claim(scope, seeded.id, 'rick', api);
  return { task: result.task, runId: result.run!.runId };
}

async function send(runId: string, status: HarnessRunStatus, extra = {}) {
  tick();
  return service.applyEvent(scope, loopback.event(runId, status, extra), host);
}

beforeEach(() => {
  now = Date.parse('2026-09-27T12:00:00.000Z');
  store = new InMemoryStore({ clock });
  tasks = new TaskService(store, { clock });
  registry = new HarnessRegistry();
  loopback = new LoopbackHarness({ clock });
  registry.register('ws-a', loopback, { agents: { rick: 'hw-agent-rick' } });
  service = new HarnessService(store, tasks, { registry, clock });
});

describe('HarnessRegistry', () => {
  it('resolves a mapped agent and ignores unmapped ones', () => {
    expect(registry.resolveAgent('ws-a', 'rick')?.harnessAgentId).toBe('hw-agent-rick');
    expect(registry.resolveAgent('ws-a', 'noir')).toBeNull();
    expect(registry.resolveAgent('ws-b', 'rick')).toBeNull();
  });

  it('holds one adapter per workspace unless replace is set', () => {
    expect(() => registry.register('ws-a', new LoopbackHarness(), { agents: {} })).toThrow(
      ValidationError,
    );
    const other = new LoopbackHarness({ name: 'other' });
    registry.register('ws-a', other, { agents: { noir: 'x' }, replace: true });
    expect(registry.get('ws-a')?.adapter).toBe(other);
    expect(registry.resolveAgent('ws-a', 'rick')).toBeNull();
    expect(registry.unregister('ws-a')).toBe(true);
    expect(registry.get('ws-a')).toBeNull();
  });

  it('copies the agent map so later edits to the input do nothing', () => {
    const agents: Record<string, string> = { scan: 'hw-scan' };
    registry.register('ws-c', loopback, { agents });
    agents.scan = 'changed';
    expect(registry.resolveAgent('ws-c', 'scan')?.harnessAgentId).toBe('hw-scan');
  });
});

describe('defaultRunEventMapping', () => {
  const event = (status: HarnessRunStatus, extra: Partial<HarnessRunEvent> = {}) =>
    ({
      id: 'e',
      taskId: 't',
      runRef: { harness: 'h', runId: 'r' },
      status,
      occurredAt: '2026-09-27T00:00:00Z',
      ...extra,
    }) as HarnessRunEvent;

  it('maps every run status', () => {
    expect(defaultRunEventMapping(event('queued'))).toEqual({ heartbeat: true });
    expect(defaultRunEventMapping(event('waiting'))).toEqual({
      heartbeat: true,
      actionState: 'open_question',
    });
    expect(defaultRunEventMapping(event('running'))).toEqual({
      status: 'in_progress',
      heartbeat: true,
      unblock: true,
      actionState: null,
    });
    expect(defaultRunEventMapping(event('succeeded', { outcome: 'ok' }))).toEqual({
      status: 'review',
      outcome: 'ok',
      actionState: null,
    });
    expect(defaultRunEventMapping(event('succeeded'), { completeTo: 'done' }).status).toBe('done');
    expect(defaultRunEventMapping(event('failed', { error: 'boom' }))).toEqual({
      block: 'Run failed: boom',
      actionState: 'run_failed',
    });
    expect(defaultRunEventMapping(event('failed')).block).toContain('no detail');
    expect(defaultRunEventMapping(event('timed_out')).block).toBe('Run timed out');
    expect(defaultRunEventMapping(event('budget_exceeded'))).toEqual({
      block: 'Run stopped: budget exceeded',
      actionState: 'run_failed',
    });
    expect(defaultRunEventMapping(event('cancelled'))).toEqual({
      status: 'planning',
      release: true,
      actionState: null,
    });
  });
});

describe('LoopbackHarness', () => {
  it('starts, reports, and cancels runs', async () => {
    const ctx = { scope, agentId: 'rick', harnessAgentId: 'hw', actor: api };
    const input = {
      id: 't1',
      title: 'x',
      description: null,
      priority: 'normal',
      projectId: null,
      workspaceId: 'ws-a',
      orgId: 'org-a',
    };
    const started = await loopback.startRun(input, ctx);
    expect(started).toEqual({ runId: 'loopback-run-1', status: 'queued' });
    const event = loopback.event(started.runId, 'running');
    expect(event).toMatchObject({ taskId: 't1', runRef: { harness: 'loopback' } });
    expect((await loopback.heartbeat(event.runRef)).status).toBe('running');
    await loopback.cancelRun(event.runRef);
    expect(loopback.cancelled).toEqual(['loopback-run-1']);
  });

  it('rejects startRun when told to fail', async () => {
    const failing = new LoopbackHarness({ failStart: 'no capacity' });
    await expect(
      failing.startRun({} as never, { scope, agentId: 'a', harnessAgentId: 'b', actor: api }),
    ).rejects.toThrow('no capacity');
  });
});

describe('HarnessService.claim', () => {
  it('claims without a run when the agent has no harness mapping', async () => {
    const seeded = store.seedTask(scope, { title: 'Manual', status: 'planning' });
    const result = await service.claim(scope, seeded.id, 'noir', api);
    expect(result.run).toBeNull();
    expect(result.task.status).toBe('in_progress');
    expect(meta(result.task).harness_run).toBeUndefined();
    expect(loopback.runs.size).toBe(0);
  });

  it('starts a run for a mapped agent and records it on the task', async () => {
    const { task, runId } = await claimed();
    expect(task.status).toBe('in_progress');
    expect(runOf(task)).toMatchObject({
      harness: 'loopback',
      run_id: runId,
      harness_agent: 'hw-agent-rick',
      status: 'queued',
      event_ids: [],
    });
    const run = loopback.runs.get(runId)!;
    expect(run.context.harnessAgentId).toBe('hw-agent-rick');
    expect(run.task).toMatchObject({ id: task.id, workspaceId: 'ws-a', orgId: 'org-a' });
    expect(store.activityRows.some((a) => a.event_type === 'harness.run.started')).toBe(true);
  });

  it('does not start a second run while one is active', async () => {
    const { task, runId } = await claimed();
    const again = await service.claim(scope, task.id, 'rick', api);
    expect(again.run?.runId).toBe(runId);
    expect(loopback.runs.size).toBe(1);
  });

  it('blocks the task when the harness refuses to start', async () => {
    registry.register('ws-a', new LoopbackHarness({ failStart: 'no capacity' }), {
      agents: { rick: 'hw' },
      replace: true,
    });
    const seeded = store.seedTask(scope, { title: 'Refused', status: 'planning' });
    const result = await service.claim(scope, seeded.id, 'rick', api);
    expect(result.run).toBeNull();
    expect(result.error).toBe('no capacity');
    expect(meta(result.task)).toMatchObject({
      blocked: true,
      blocked_reason: 'Harness start failed: no capacity',
      blocked_by: 'harness:loopback',
    });
  });

  it('is wired into createServices', async () => {
    const services = createServices(store, { clock, harnessRegistry: registry });
    const seeded = store.seedTask(scope, { title: 'Wired', status: 'planning' });
    const result = await services.harness.claim(scope, seeded.id, 'rick', api);
    expect(result.run?.harness).toBe('loopback');
    expect(services.harness.registry).toBe(registry);
  });
});

describe('stored harness connections', () => {
  const wsB = createScope({ workspaceId: 'ws-b', orgId: 'org-b', actorId: 'user-b' });
  const wsC = createScope({ workspaceId: 'ws-c', orgId: 'org-c', actorId: 'user-c' });
  let configs: Array<Readonly<Record<string, unknown>>>;

  function factoryRegistry() {
    const r = new HarnessRegistry({
      factories: {
        loopback: (config) => {
          configs.push(config);
          return loopback;
        },
      },
    });
    return r;
  }

  function freshService() {
    return new HarnessService(store, new TaskService(store, { clock }), {
      registry: factoryRegistry(),
      clock,
    });
  }

  beforeEach(() => {
    configs = [];
  });

  it('keeps a registration across a restart', async () => {
    const first = freshService();
    const saved = await first.connect(
      wsB,
      { harness: 'loopback', agents: { rick: 'hw-rick' }, config: { baseUrl: 'https://h.test' } },
      api,
    );
    expect(saved).toMatchObject({ harness: 'loopback', agents: { rick: 'hw-rick' } });

    const restarted = freshService();
    const seeded = store.seedTask(wsB, { title: 'After restart', status: 'planning' });
    const result = await restarted.claim(wsB, seeded.id, 'rick', api);
    expect(result.run?.harness).toBe('loopback');
    expect(runOf(result.task).harness_agent).toBe('hw-rick');
    expect(configs.at(-1)).toEqual({ baseUrl: 'https://h.test' });
    expect(await restarted.connection(wsB)).toMatchObject({ createdBy: 'user-a' });
  });

  it('uses a connection only in its own workspace', async () => {
    const svc = freshService();
    await svc.connect(wsB, { harness: 'loopback', agents: { rick: 'hw-rick' } }, api);
    const other = store.seedTask(wsC, { title: 'Other', status: 'planning' });
    const result = await svc.claim(wsC, other.id, 'rick', api);
    expect(result.run).toBeNull();
    expect(await svc.connection(wsC)).toBeNull();
  });

  it('refuses config that holds a credential, at any depth', async () => {
    const svc = freshService();
    for (const config of [
      { apiKey: 'x' },
      { nested: { client_secret: 'x' } },
      { profiles: [{ token: 'x' }] },
    ]) {
      await expect(
        svc.connect(wsB, { harness: 'loopback', agents: {}, config }, api),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await svc.connection(wsB)).toBeNull();
  });

  it('refuses a harness without a factory and a malformed agent map', async () => {
    const svc = freshService();
    await expect(svc.connect(wsB, { harness: 'unknown', agents: {} }, api)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      svc.connect(wsB, { harness: 'loopback', agents: { rick: 7 } as never }, api),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a second connection unless replace is set, and a replace takes effect', async () => {
    const svc = freshService();
    await svc.connect(wsB, { harness: 'loopback', agents: { rick: 'hw-rick' } }, api);
    await expect(
      svc.connect(wsB, { harness: 'loopback', agents: { noir: 'hw-noir' } }, api),
    ).rejects.toBeInstanceOf(Conflict);
    tick();
    await freshService().connect(
      wsB,
      { harness: 'loopback', agents: { noir: 'hw-noir' }, replace: true },
      api,
    );
    const seeded = store.seedTask(wsB, { title: 'Rick', status: 'planning' });
    expect((await svc.claim(wsB, seeded.id, 'rick', api)).run).toBeNull();
  });

  it('stops starting runs after a disconnect', async () => {
    const svc = freshService();
    await svc.connect(wsB, { harness: 'loopback', agents: { rick: 'hw-rick' } }, api);
    expect(await svc.disconnect(wsB)).toBe(true);
    expect(await svc.disconnect(wsB)).toBe(false);
    const seeded = store.seedTask(wsB, { title: 'Gone', status: 'planning' });
    expect((await freshService().claim(wsB, seeded.id, 'rick', api)).run).toBeNull();
  });

  it('prefers an adapter the host registered in code and refuses to store over it', async () => {
    const r = factoryRegistry();
    r.register('ws-b', loopback, { agents: { rick: 'code-rick' } });
    const svc = new HarnessService(store, tasks, { registry: r, clock });
    await expect(
      svc.connect(wsB, { harness: 'loopback', agents: { rick: 'hw-rick' } }, api),
    ).rejects.toBeInstanceOf(Conflict);
  });

  it('does not resolve inherited object keys as agents', async () => {
    const svc = freshService();
    await svc.connect(wsB, { harness: 'loopback', agents: { rick: 'hw-rick' } }, api);
    const seeded = store.seedTask(wsB, { title: 'Proto', status: 'planning' });
    expect((await svc.claim(wsB, seeded.id, 'constructor', api)).run).toBeNull();
  });

  it('answers Unavailable when the store keeps no connections', async () => {
    const bare = Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
      harnessConnections: undefined,
    }) as InMemoryStore;
    const svc = new HarnessService(bare, new TaskService(bare, { clock }), {
      registry: factoryRegistry(),
    });
    await expect(svc.connect(wsB, { harness: 'loopback', agents: {} }, api)).rejects.toBeInstanceOf(
      Unavailable,
    );
  });
});

describe('HarnessService.activeRuns', () => {
  it('lists open runs of one harness in the scope with their event ids', async () => {
    const { task, runId } = await claimed();
    const running = await send(runId, 'running');
    const ended = await claimed('Already done');
    await send(ended.runId, 'succeeded');
    store.seedTask(createScope({ workspaceId: 'ws-b' }), {
      title: 'Other workspace',
      metadata: { harness_run: { harness: 'loopback', run_id: 'x', status: 'running' } },
    });

    expect(await service.activeRuns(scope, 'loopback')).toEqual([
      {
        task_id: task.id,
        harness: 'loopback',
        run_id: runId,
        harness_agent: 'hw-agent-rick',
        status: 'running',
        last_event_at: runOf(running.task).last_event_at,
        event_ids: runOf(running.task).event_ids,
        run_as: null,
      },
    ]);
    expect(await service.activeRuns(scope, 'headways')).toEqual([]);
    await expect(service.activeRuns(scope, ' ')).rejects.toThrow('harness is required');
  });
});

describe('HarnessService.applyEvent', () => {
  it('records a running run as a heartbeat and keeps the agent working', async () => {
    const { task, runId } = await claimed();
    const result = await send(runId, 'running', { progress: { step: 2 } });
    expect(result).toMatchObject({ applied: true, duplicate: false, stale: false });
    expect(result.task.status).toBe('in_progress');
    expect(runOf(result.task).status).toBe('running');
    const beat = store.heartbeatRows.at(-1)!;
    // heartbeat_events_event_type_check allows a closed set; `working` is in it.
    expect(beat).toMatchObject({ agentId: 'hw-agent-rick', eventType: 'working' });
    expect(beat.metadata).toMatchObject({
      harness_status: 'running',
      task_id: task.id,
      run_id: runId,
      progress: { step: 2 },
    });
    expect(store.agentRows.get('ws-a:rick')).toMatchObject({ status: 'working' });
  });

  it('moves a succeeded run to review with the outcome', async () => {
    const { runId } = await claimed();
    await send(runId, 'running');
    const result = await send(runId, 'succeeded', { outcome: 'Shipped PR 12' });
    expect(result.task.status).toBe('review');
    expect(result.task.outcome).toBe('Shipped PR 12');
    expect(runOf(result.task).ended_at).toBeDefined();
    expect(store.activityRows.some((a) => a.event_type === 'harness.run.succeeded')).toBe(true);
  });

  it('completes through TaskService.complete when the adapter maps success to done', async () => {
    const done = new LoopbackHarness({ clock, mapping: { completeTo: 'done' } });
    registry.register('ws-a', done, { agents: { rick: 'hw' }, replace: true });
    loopback = done;
    const { runId } = await claimed();
    const result = await send(runId, 'succeeded', { outcome: 'All green' });
    expect(result.task.status).toBe('done');
    expect(meta(result.task).completed_by).toBe('rick');
    expect(store.memoryRows.at(-1)?.outcome).toBe('All green');
  });

  it('ignores a repeated event id', async () => {
    const { runId } = await claimed();
    tick();
    const event = loopback.event(runId, 'succeeded', { outcome: 'once' });
    const first = await service.applyEvent(scope, event, host);
    const second = await service.applyEvent(scope, event, host);
    expect(first.applied).toBe(true);
    expect(second).toMatchObject({ applied: false, duplicate: true });
    expect(store.activityRows.filter((a) => a.event_type === 'harness.run.succeeded')).toHaveLength(
      1,
    );
  });

  it('ignores a repeated event id after a restart through the ids kept on the task', async () => {
    const { runId } = await claimed();
    tick();
    const event = loopback.event(runId, 'running');
    await service.applyEvent(scope, event, host);
    const restarted = new HarnessService(store, tasks, { registry, clock });
    const replay = await restarted.applyEvent(scope, event, host);
    expect(replay.duplicate).toBe(true);
  });

  it('marks older events stale and leaves the task alone', async () => {
    const { runId } = await claimed();
    const early = new Date(now + 500).toISOString();
    await send(runId, 'succeeded', { outcome: 'done' });
    const late = await service.applyEvent(
      scope,
      loopback.event(runId, 'running', { occurredAt: early }),
      host,
    );
    expect(late).toMatchObject({ applied: false, stale: true });
    expect(late.task.status).toBe('review');
    expect(runOf(late.task).status).toBe('succeeded');
  });

  it('applies only the first terminal event of a run', async () => {
    const { runId } = await claimed();
    tick();
    await send(runId, 'cancelled');
    tick();
    const late = await send(runId, 'succeeded', { outcome: 'raced the cancel' });
    expect(late).toMatchObject({ applied: false, stale: true });
    expect(runOf(late.task).status).toBe('cancelled');
    expect(late.task.status).toBe('planning');
    expect(store.activityRows.filter((a) => a.event_type === 'harness.run.succeeded')).toHaveLength(
      0,
    );
  });

  it('blocks on failure, timeout, and budget without changing status', async () => {
    for (const [status, reason] of [
      ['failed', 'Run failed: tool crashed'],
      ['timed_out', 'Run timed out'],
      ['budget_exceeded', 'Run stopped: budget exceeded'],
    ] as const) {
      const { runId } = await claimed(`Task ${status}`);
      const result = await send(runId, status, { error: 'tool crashed' });
      expect(result.task.status).toBe('in_progress');
      expect(meta(result.task)).toMatchObject({
        blocked: true,
        blocked_reason: reason,
        blocked_by: 'harness:loopback',
        action_state: 'run_failed',
      });
    }
  });

  it('flags a waiting run as an open question and clears it when the run resumes', async () => {
    const { runId } = await claimed();
    const waiting = await send(runId, 'waiting');
    expect(meta(waiting.task).action_state).toBe('open_question');
    const resumed = await send(runId, 'running');
    expect(meta(resumed.task).action_state).toBeNull();
  });

  it('lifts a harness block when a new run starts, and keeps a person block', async () => {
    const { task, runId } = await claimed();
    await send(runId, 'budget_exceeded');
    tick();
    const retry: HarnessRunEvent = {
      id: 'retry-1',
      taskId: task.id,
      runRef: { harness: 'loopback', runId: 'host-retry-1' },
      status: 'running',
      occurredAt: clock().toISOString(),
    };
    const resumed = await service.applyEvent(scope, retry, host);
    expect(meta(resumed.task).blocked).toBeUndefined();
    expect(runOf(resumed.task).run_id).toBe('host-retry-1');

    await tasks.block(scope, task.id, { reason: 'Waiting on legal', agentId: 'eric' }, api);
    tick();
    const next = await service.applyEvent(
      scope,
      { ...retry, id: 'retry-2', occurredAt: clock().toISOString() },
      host,
    );
    expect(meta(next.task)).toMatchObject({ blocked: true, blocked_reason: 'Waiting on legal' });
  });

  it('refuses an event for a different run while one is active', async () => {
    const { task } = await claimed();
    await expect(
      service.applyEvent(
        scope,
        {
          id: 'x',
          taskId: task.id,
          runRef: { harness: 'loopback', runId: 'someone-else' },
          status: 'running',
          occurredAt: clock().toISOString(),
        },
        host,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses an event from a different harness', async () => {
    const { task, runId } = await claimed();
    await expect(
      service.applyEvent(
        scope,
        {
          id: 'x',
          taskId: task.id,
          runRef: { harness: 'other', runId },
          status: 'running',
          occurredAt: clock().toISOString(),
        },
        host,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('respects the transition validator and frees the id for a retry', async () => {
    const seeded = store.seedTask(scope, { title: 'Fresh', status: 'inbox' });
    const event: HarnessRunEvent = {
      id: 'early-success',
      taskId: seeded.id,
      runRef: { harness: 'loopback', runId: 'r1' },
      status: 'succeeded',
      occurredAt: clock().toISOString(),
    };
    await expect(service.applyEvent(scope, event, host)).rejects.toThrow(InvalidTransition);
    await expect(service.applyEvent(scope, event, host)).rejects.toThrow(InvalidTransition);
    expect((await tasks.get(scope, seeded.id)).status).toBe('inbox');
  });

  it('rejects a malformed event', async () => {
    await expect(
      service.applyEvent(
        scope,
        {
          id: '',
          taskId: 't',
          runRef: { harness: 'h', runId: 'r' },
          status: 'exploded' as HarnessRunStatus,
          occurredAt: 'not a date',
        },
        host,
      ),
    ).rejects.toMatchObject({ details: { fields: ['id', 'status', 'occurredAt'] } });
  });

  it('applies the default mapping when the workspace has no adapter', async () => {
    registry.unregister('ws-a');
    const seeded = store.seedTask(scope, { title: 'Host run', status: 'planning' });
    const event: HarnessRunEvent = {
      id: 'e1',
      taskId: seeded.id,
      runRef: { harness: 'external', runId: 'ext-1' },
      status: 'running',
      occurredAt: clock().toISOString(),
    };
    const result = await service.applyEvent(scope, event, host);
    expect(result.task.status).toBe('in_progress');
    expect(runOf(result.task)).toMatchObject({ harness: 'external', run_id: 'ext-1' });
  });
});

describe('HarnessService.heartbeat and cancel', () => {
  it('pulls the run state and applies it', async () => {
    const { task, runId } = await claimed();
    loopback.runs.get(runId)!.status = 'running';
    tick();
    const result = await service.heartbeat(scope, task.id, api);
    expect(result.applied).toBe(true);
    expect(runOf(result.task).status).toBe('running');
  });

  it('refuses heartbeat when the harness lacks it', async () => {
    const quiet = new LoopbackHarness({ clock, capabilities: { heartbeat: false } });
    registry.register('ws-a', quiet, { agents: { rick: 'hw' }, replace: true });
    loopback = quiet;
    const { task } = await claimed();
    await expect(service.heartbeat(scope, task.id, api)).rejects.toThrow(Unavailable);
  });

  it('cancels the run and returns the task to planning', async () => {
    const { task, runId } = await claimed();
    tick();
    const result = await service.cancel(scope, task.id, api);
    expect(loopback.cancelled).toEqual([runId]);
    expect(result.task.status).toBe('planning');
    expect(meta(result.task).active_session).toBe(false);
    expect(runOf(result.task).status).toBe('cancelled');
    await expect(service.cancel(scope, task.id, api)).rejects.toThrow(ValidationError);
  });

  it('treats the host echo of a Celune cancel as a duplicate', async () => {
    const { task, runId } = await claimed();
    tick();
    await service.cancel(scope, task.id, api);
    tick();
    const echo = await service.applyEvent(
      scope,
      {
        id: `cancel:${runId}`,
        taskId: task.id,
        runRef: { harness: 'loopback', runId },
        status: 'cancelled',
        occurredAt: clock().toISOString(),
      },
      host,
    );
    expect(echo.duplicate).toBe(true);
  });

  it('refuses heartbeat for a task with no run', async () => {
    const seeded = store.seedTask(scope, { title: 'No run' });
    await expect(service.heartbeat(scope, seeded.id, api)).rejects.toThrow(ValidationError);
  });

  it('keeps TaskService rules on claim', async () => {
    const seeded = store.seedTask(scope, { title: 'Blocked', status: 'planning' });
    await tasks.block(scope, seeded.id, { reason: 'hold' }, api);
    await expect(service.claim(scope, seeded.id, 'rick', api)).rejects.toThrow(TaskBlocked);
    expect(loopback.runs.size).toBe(0);
  });
});

describe('HarnessService concurrency and access', () => {
  it('applies concurrent events for one run without losing the newer one', async () => {
    const { task, runId } = await claimed();
    tick();
    const running = loopback.event(runId, 'running');
    tick();
    const succeeded = loopback.event(runId, 'succeeded', { outcome: 'Shipped' });

    // Both events read the task before either writes, and the running event
    // stalls in its heartbeat until the succeeded event has finished.
    const get = store.tasks.get;
    let reads = 0;
    let bothRead!: () => void;
    const barrier = new Promise<void>((resolve) => (bothRead = resolve));
    store.tasks.get = async (...args) => {
      const row = await get(...args);
      reads += 1;
      if (reads === 2) bothRead();
      if (reads <= 2) await barrier;
      return row;
    };
    let succeededDone!: () => void;
    const afterSucceeded = new Promise<void>((resolve) => (succeededDone = resolve));
    const heartbeat = store.agents.appendHeartbeat;
    store.agents.appendHeartbeat = async (...args) => {
      if (args[1].eventType === 'harness.running') await afterSucceeded;
      return heartbeat(...args);
    };

    await Promise.all([
      service.applyEvent(scope, running, host),
      service.applyEvent(scope, succeeded, host).finally(() => succeededDone()),
    ]);
    store.tasks.get = get;
    store.agents.appendHeartbeat = heartbeat;

    const after = await tasks.get(scope, task.id);
    expect(after.status).toBe('review');
    expect(runOf(after)).toMatchObject({ status: 'succeeded', last_event_id: succeeded.id });
    expect(runOf(after).ended_at).toBe(succeeded.occurredAt);
  });

  it('starts one run when two claims race', async () => {
    const seeded = store.seedTask(scope, { title: 'Race', status: 'planning' });
    const [a, b] = await Promise.all([
      service.claim(scope, seeded.id, 'rick', api),
      service.claim(scope, seeded.id, 'rick', api),
    ]);
    expect(loopback.runs.size).toBe(1);
    const started = [...loopback.runs.keys()][0];
    expect(runOf(await tasks.get(scope, seeded.id)).run_id).toBe(started);
    expect([a.run?.runId, b.run?.runId]).toContain(started);
  });

  it('dedupes one event id across service instances that share a ledger', async () => {
    const ledger = new InMemoryHarnessLedger();
    const one = new HarnessService(store, tasks, { registry, clock, ledger });
    const two = new HarnessService(store, tasks, { registry, clock, ledger });
    const { runId } = await claimed();
    tick();
    const event = loopback.event(runId, 'running');
    const results = await Promise.all([
      one.applyEvent(scope, event, host),
      two.applyEvent(scope, event, host),
    ]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
  });

  it("uses the store's ledger by default", async () => {
    const taken: string[] = [];
    const ledger: HarnessEventLedger = {
      take: async (_scope, id) => {
        taken.push(id);
        return true;
      },
      release: async () => {},
    };
    const withLedger = Object.assign(store, { harnessEvents: ledger });
    const services = createServices(withLedger, { clock, harnessRegistry: registry });
    const seeded = store.seedTask(scope, { title: 'Ledger', status: 'planning' });
    const { run } = await services.harness.claim(scope, seeded.id, 'rick', api);
    tick();
    await services.harness.applyEvent(scope, loopback.event(run!.runId, 'running'), host);
    expect(taken).toHaveLength(1);
  });

  it('ignores a late event from an older run once a newer run started', async () => {
    const { task, runId } = await claimed();
    tick();
    const oldRunning = loopback.event(runId, 'running');
    await send(runId, 'failed');
    tick();
    await service.applyEvent(
      scope,
      {
        id: 'retry-run',
        taskId: task.id,
        runRef: { harness: 'loopback', runId: 'host-retry' },
        status: 'succeeded',
        occurredAt: clock().toISOString(),
        outcome: 'Done on retry',
      },
      host,
    );
    const before = await tasks.get(scope, task.id);
    expect(before.status).toBe('review');

    const late = await service.applyEvent(scope, oldRunning, host);
    expect(late).toMatchObject({ applied: false, stale: true });
    const after = await tasks.get(scope, task.id);
    expect(after.status).toBe('review');
    expect(runOf(after).run_id).toBe('host-retry');
  });

  it('refuses a run start when the caller may not start runs', async () => {
    const seeded = store.seedTask(scope, { title: 'Embed', status: 'planning' });
    await expect(
      service.claim(scope, seeded.id, 'rick', api, { allowRunStart: false }),
    ).rejects.toThrow(GateDenied);
    expect((await tasks.get(scope, seeded.id)).status).toBe('planning');
    expect(loopback.runs.size).toBe(0);

    const plain = await service.claim(scope, seeded.id, 'noir', api, { allowRunStart: false });
    expect(plain.run).toBeNull();
  });

  it('checks the agent.run gate before starting a run', async () => {
    const checked: string[] = [];
    const gate: Gate = {
      check: async (feature) => {
        checked.push(feature);
        return { allowed: false, reason: 'Run budget used up', status: 402 };
      },
    };
    const gated = new HarnessService(store, tasks, { registry, clock, gate });
    const seeded = store.seedTask(scope, { title: 'Gated', status: 'planning' });
    await expect(gated.claim(scope, seeded.id, 'rick', api)).rejects.toMatchObject({
      code: 'gate_denied',
      status: 402,
    });
    expect(checked).toEqual(['agent.run']);
    expect(loopback.runs.size).toBe(0);
    expect((await tasks.get(scope, seeded.id)).status).toBe('planning');
  });
});
