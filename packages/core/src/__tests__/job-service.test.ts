import { beforeEach, describe, expect, it } from 'vitest';
import { JobService } from '../jobs/job-service.ts';
import { createScope } from '../scope.ts';
import { InMemoryStore } from '../testing/memory-store.ts';

const scopeA = createScope({ workspaceId: 'ws-a', orgId: 'org-a', actorId: 'user-a' });
const scopeB = createScope({ workspaceId: 'ws-b', orgId: 'org-b', actorId: 'user-b' });
const clock = () => new Date('2026-09-26T12:00:00.000Z');
const key1 = { keyId: 'key-1' };
const key2 = { keyId: 'key-2' };
const worker1 = { workerId: 'worker-1' };

let store: InMemoryStore;
let service: JobService;

beforeEach(() => {
  store = new InMemoryStore({ clock });
  service = new JobService(store, { clock });
});

describe('JobService.enqueue', () => {
  it('defaults to the external runner and the default queue', async () => {
    const job = await service.enqueue(scopeA, { job_type: 'chat' });
    expect(store.jobRows.get(job.id)).toMatchObject({
      runner: 'external',
      queue_name: 'default',
      status: 'pending',
      workspace_id: 'ws-a',
    });
  });

  it('records a server run with its target', async () => {
    const job = await service.enqueue(scopeA, {
      runner: 'server',
      job_type: 'agent_run',
      target_type: 'task',
      target_id: 'task-1',
      metadata: { agent_id: 'rick' },
    });
    expect(store.jobRows.get(job.id)).toMatchObject({
      runner: 'server',
      target_type: 'task',
      target_id: 'task-1',
    });
  });
});

describe('JobService.poll', () => {
  it('returns pending jobs by priority with the queue depth', async () => {
    store.seedJob(scopeA, { id: 'low', priority: 1, created_at: '2026-01-01T00:00:00Z' });
    store.seedJob(scopeA, { id: 'high', priority: 5, created_at: '2026-01-02T00:00:00Z' });
    store.seedJob(scopeA, { id: 'claimed', status: 'claimed' });
    store.seedJob(scopeB, { id: 'foreign' });
    const result = await service.poll(scopeA, { limit: 1 });
    expect(result.jobs.map((j) => j.id)).toEqual(['high']);
    expect(result.queue_depth).toBe(2);
  });

  it('filters by job type and honours retry cooldown', async () => {
    store.seedJob(scopeA, { id: 'chat', job_type: 'chat' });
    store.seedJob(scopeA, { id: 'embed', job_type: 'embedding' });
    store.seedJob(scopeA, {
      id: 'later',
      job_type: 'chat',
      retry_after: '2099-01-01T00:00:00.000Z',
    });
    const result = await service.poll(scopeA, { jobTypes: ['chat'] });
    expect(result.jobs.map((j) => j.id)).toEqual(['chat']);
  });

  it('keeps server and external jobs apart', async () => {
    store.seedJob(scopeA, { id: 'ide', runner: 'external' });
    store.seedJob(scopeA, { id: 'srv', runner: 'server', job_type: 'agent_run' });
    const external = await service.poll(scopeA);
    expect(external.jobs.map((j) => j.id)).toEqual(['ide']);
    expect(external.queue_depth).toBe(1);
    const server = await service.poll(scopeA, { runner: 'server' });
    expect(server.jobs.map((j) => j.id)).toEqual(['srv']);
    expect((await service.nextPending(scopeA))?.id).toBe('ide');
    expect((await service.nextPending(scopeA, 'server'))?.id).toBe('srv');
  });

  it('counts active jobs per runner', async () => {
    store.seedJob(scopeA, { id: 'a', runner: 'server', status: 'pending' });
    store.seedJob(scopeA, { id: 'b', runner: 'server', status: 'streaming' });
    store.seedJob(scopeA, { id: 'c', runner: 'server', status: 'completed' });
    store.seedJob(scopeA, { id: 'd', runner: 'external', status: 'claimed' });
    expect(await service.countActive(scopeA, 'server')).toBe(2);
    expect(await service.countActive(scopeA, 'external')).toBe(1);
  });
});

describe('JobService.claim', () => {
  it('claims once with an API key and refuses the second claim', async () => {
    store.seedJob(scopeA, { id: 'j1' });
    const first = await service.claim(scopeA, 'j1', key1);
    expect(first.claimed).toBe(true);
    const second = await service.claim(scopeA, 'j1', key2);
    expect(second).toEqual({ claimed: false, reason: 'Job already claimed or not found' });
    expect(store.jobRows.get('j1')).toMatchObject({
      status: 'claimed',
      claimed_by_key_id: 'key-1',
      worker_id: null,
    });
  });

  it('claims a server job with a worker id through the same path', async () => {
    store.seedJob(scopeA, { id: 'j1', runner: 'server', job_type: 'agent_run' });
    const first = await service.claim(scopeA, 'j1', worker1);
    expect(first.claimed).toBe(true);
    expect(store.jobRows.get('j1')).toMatchObject({
      status: 'claimed',
      worker_id: 'worker-1',
      claimed_by_key_id: null,
    });
    const again = await service.claim(scopeA, 'j1', { workerId: 'worker-2' });
    expect(again.claimed).toBe(false);
  });

  it('matches the claimant to the runner', async () => {
    store.seedJob(scopeA, { id: 'server-job', runner: 'server', job_type: 'agent_run' });
    store.seedJob(scopeA, { id: 'external-job' });
    expect((await service.claim(scopeA, 'server-job', key1)).claimed).toBe(false);
    expect(store.jobRows.get('server-job')).toMatchObject({ status: 'pending' });
    expect((await service.claim(scopeA, 'external-job', worker1)).claimed).toBe(false);
    expect(store.jobRows.get('external-job')).toMatchObject({ status: 'pending' });
  });

  it('cannot claim across workspaces', async () => {
    store.seedJob(scopeB, { id: 'j1' });
    const result = await service.claim(scopeA, 'j1', key1);
    expect(result.claimed).toBe(false);
  });

  it('exposes metadata before claiming', async () => {
    store.seedJob(scopeA, { id: 'j1', metadata: { agent_id: 'rick' } });
    expect(await service.peekMetadata(scopeA, 'j1')).toEqual({ agent_id: 'rick' });
    expect(await service.peekMetadata(scopeA, 'missing')).toEqual({});
  });
});

describe('JobService.heartbeat', () => {
  it('moves a claimed job to streaming and stores a checkpoint', async () => {
    store.seedJob(scopeA, { id: 'j1', status: 'claimed', claimed_by_key_id: 'key-1' });
    const result = await service.heartbeat(scopeA, 'j1', key1, {
      partial_result: 'half',
      tokens_so_far: 10,
    });
    expect(result).toEqual({ continue: true });
    expect(store.jobRows.get('j1')).toMatchObject({
      status: 'streaming',
      metadata: { _checkpoint: 'half', _checkpoint_tokens: 10 },
    });
  });

  it('drops the checkpoint when the job changes hands between the two writes', async () => {
    store.seedJob(scopeA, { id: 'j1', status: 'claimed', claimed_by_key_id: 'key-1' });
    const heartbeat = store.jobs.heartbeat;
    let calls = 0;
    store.jobs.heartbeat = async (...args) => {
      const row = await heartbeat(...args);
      calls++;
      if (calls === 1)
        store.jobRows.set('j1', { ...store.jobRows.get('j1')!, claimed_by_key_id: 'key-2' });
      return row;
    };
    const result = await service.heartbeat(scopeA, 'j1', key1, { partial_result: 'half' });
    expect(result).toEqual({ continue: false });
    expect(store.jobRows.get('j1')?.metadata).not.toHaveProperty('_checkpoint');
  });

  it('stops when the job is not owned or was cancelled', async () => {
    store.seedJob(scopeA, { id: 'j1', status: 'claimed', claimed_by_key_id: 'key-1' });
    expect(await service.heartbeat(scopeA, 'j1', key2)).toEqual({ continue: false });
    store.seedJob(scopeA, { id: 'j2', status: 'cancelled', claimed_by_key_id: 'key-1' });
    expect(await service.heartbeat(scopeA, 'j2', key1)).toEqual({ continue: false });
  });

  it('accepts a worker heartbeat only from the claiming worker', async () => {
    store.seedJob(scopeA, { id: 'j1', runner: 'server', status: 'claimed', worker_id: 'worker-1' });
    expect(await service.heartbeat(scopeA, 'j1', { workerId: 'worker-2' })).toEqual({
      continue: false,
    });
    expect(await service.heartbeat(scopeA, 'j1', key1)).toEqual({ continue: false });
    expect(await service.heartbeat(scopeA, 'j1', worker1, { tokens_so_far: 5 })).toEqual({
      continue: true,
    });
    expect(store.jobRows.get('j1')?.status).toBe('streaming');
  });
});

describe('JobService.getOwned / submitResult', () => {
  it('reports not_found, not_owner, and bad_state', async () => {
    expect(await service.getOwned(scopeA, 'nope', key1)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    store.seedJob(scopeA, { id: 'j1', status: 'claimed', claimed_by_key_id: 'key-1' });
    expect(await service.getOwned(scopeA, 'j1', key2)).toEqual({
      ok: false,
      reason: 'not_owner',
    });
    expect(await service.getOwned(scopeA, 'j1', worker1)).toEqual({
      ok: false,
      reason: 'not_owner',
    });
    store.seedJob(scopeA, { id: 'j2', status: 'completed', claimed_by_key_id: 'key-1' });
    expect(await service.getOwned(scopeA, 'j2', key1)).toEqual({
      ok: false,
      reason: 'bad_state',
      status: 'completed',
    });
  });

  it('stores an encrypted result on completion', async () => {
    store.seedJob(scopeA, { id: 'j1', status: 'streaming', claimed_by_key_id: 'key-1' });
    const owned = await service.getOwned(scopeA, 'j1', key1);
    if (!owned.ok) throw new Error('expected owned job');
    await service.submitResult(scopeA, owned.job, {
      status: 'completed',
      result: { result_encrypted: '\\xaa', result_iv: '\\xbb' },
    });
    expect(store.jobRows.get('j1')).toMatchObject({
      status: 'completed',
      result_encrypted: '\\xaa',
      result_iv: '\\xbb',
      completed_at: '2026-09-26T12:00:00.000Z',
    });
  });

  it('lets a worker complete a server run with usage columns', async () => {
    store.seedJob(scopeA, {
      id: 'j1',
      runner: 'server',
      status: 'streaming',
      worker_id: 'worker-1',
    });
    const owned = await service.getOwned(scopeA, 'j1', worker1);
    if (!owned.ok) throw new Error('expected owned job');
    await service.submitResult(scopeA, owned.job, {
      status: 'completed',
      result: { result_encrypted: '\\xaa', result_iv: '\\xbb' },
      extra: { tokens_used: 1234 },
    });
    expect(store.jobRows.get('j1')).toMatchObject({ status: 'completed', tokens_used: 1234 });
  });

  it('requeues a retryable failure with exponential backoff', async () => {
    store.seedJob(scopeA, {
      id: 'j1',
      status: 'claimed',
      claimed_by_key_id: 'key-1',
      attempt: 1,
      max_attempts: 3,
    });
    const owned = await service.getOwned(scopeA, 'j1', key1);
    if (!owned.ok) throw new Error('expected owned job');
    await service.submitResult(scopeA, owned.job, {
      status: 'failed',
      error: { code: 'rate_limit', message: 'slow down', retryable: true },
    });
    expect(store.jobRows.get('j1')).toMatchObject({
      status: 'pending',
      attempt: 2,
      claimed_by_key_id: null,
      worker_id: null,
      retry_after: '2026-09-26T12:00:10.000Z',
    });
  });

  it('fails for good once attempts are exhausted', async () => {
    store.seedJob(scopeA, {
      id: 'j1',
      status: 'claimed',
      claimed_by_key_id: 'key-1',
      attempt: 3,
      max_attempts: 3,
    });
    const owned = await service.getOwned(scopeA, 'j1', key1);
    if (!owned.ok) throw new Error('expected owned job');
    await service.submitResult(scopeA, owned.job, {
      status: 'failed',
      error: { code: 'boom', message: 'x', retryable: true },
    });
    expect(store.jobRows.get('j1')?.status).toBe('failed');
  });

  it('returns the next pending job', async () => {
    expect(await service.nextPending(scopeA)).toBeNull();
    store.seedJob(scopeA, { id: 'j1' });
    expect((await service.nextPending(scopeA))?.id).toBe('j1');
  });
});

describe('JobService.cancel', () => {
  it('cancels active jobs and leaves terminal ones alone', async () => {
    store.seedJob(scopeA, { id: 'run', runner: 'server', status: 'streaming', worker_id: 'w' });
    store.seedJob(scopeA, { id: 'done', runner: 'server', status: 'completed' });
    expect((await service.cancel(scopeA, 'run'))?.status).toBe('cancelled');
    expect(await service.cancel(scopeA, 'done')).toBeNull();
    expect(await service.cancel(scopeB, 'run')).toBeNull();
    expect(await service.heartbeat(scopeA, 'run', { workerId: 'w' })).toEqual({
      continue: false,
    });
  });
});

describe('JobService.list / findActive', () => {
  it('lists server runs for a target newest first with a total', async () => {
    store.seedJob(scopeA, {
      id: 'old',
      runner: 'server',
      target_type: 'task',
      target_id: 't1',
      status: 'completed',
      created_at: '2026-01-01T00:00:00Z',
    });
    store.seedJob(scopeA, {
      id: 'new',
      runner: 'server',
      target_type: 'task',
      target_id: 't1',
      status: 'pending',
      created_at: '2026-01-02T00:00:00Z',
    });
    store.seedJob(scopeA, { id: 'other', runner: 'server', target_type: 'task', target_id: 't2' });
    store.seedJob(scopeA, { id: 'ide', runner: 'external' });
    const result = await service.list(scopeA, { runner: 'server', targetId: 't1', limit: 1 });
    expect(result.rows.map((j) => j.id)).toEqual(['new']);
    expect(result.total).toBe(2);
    const active = await service.findActive(scopeA, {
      runner: 'server',
      targetType: 'task',
      targetId: 't1',
    });
    expect(active?.id).toBe('new');
  });
});

describe('JobService logs', () => {
  it('appends and lists step logs per job in step order', async () => {
    store.seedJob(scopeA, { id: 'j1' });
    store.seedJob(scopeA, { id: 'j2' });
    await service.appendLog(scopeA, { job_id: 'j1', step_index: 1, event_type: 'message' });
    await service.appendLog(scopeA, { job_id: 'j1', step_index: 0, event_type: 'status_change' });
    await service.appendLog(scopeA, { job_id: 'j2', step_index: 0, event_type: 'message' });
    await expect(
      service.appendLog(scopeB, { job_id: 'j1', step_index: 5, event_type: 'error' }),
    ).rejects.toThrow(/Job not found/);
    const logs = await service.listLogs(scopeA, 'j1');
    expect(logs.map((l) => l.step_index)).toEqual([0, 1]);
    expect(logs.every((l) => l.workspace_id === 'ws-a')).toBe(true);
  });
});

describe('JobService.expire', () => {
  it('returns stale claims to pending within the scope', async () => {
    store.seedJob(scopeA, {
      id: 'stale',
      status: 'claimed',
      last_heartbeat_at: '2026-01-01T00:00:00Z',
    });
    store.seedJob(scopeA, {
      id: 'fresh',
      status: 'claimed',
      last_heartbeat_at: '2026-12-01T00:00:00Z',
    });
    store.seedJob(scopeB, {
      id: 'foreign',
      status: 'claimed',
      last_heartbeat_at: '2026-01-01T00:00:00Z',
    });
    expect(await service.expire(scopeA, '2026-06-01T00:00:00Z')).toBe(1);
    expect(store.jobRows.get('stale')?.status).toBe('pending');
    expect(store.jobRows.get('fresh')?.status).toBe('claimed');
    expect(store.jobRows.get('foreign')?.status).toBe('claimed');
  });
});
