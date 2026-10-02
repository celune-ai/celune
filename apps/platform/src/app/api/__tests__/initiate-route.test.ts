import './setup-security-mocks';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createScope, createServices, type Services } from '@celuneai/core';
import { InMemoryStore } from '@celuneai/core/testing';
import { verifyJobHmac } from '@/lib/ai-job-queue/crypto';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';

/**
 * Integration-style test: the initiate route enqueues a server run through
 * JobService, and the same JobService instance can claim it as the worker.
 */

process.env.PROVIDER_KEY_ENCRYPTION_KEY = 'ab'.repeat(32);

const WORKSPACE_ID = '65ea5cdf-758d-4613-903e-f06917717051';
const ORG_ID = '7f0d2b6e-3c4a-4d5e-8f9a-0b1c2d3e4f5a';
const TASK_ID = 'b2d9c1e4-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const USER_ID = 'test-user-id';

const holder = vi.hoisted(() => ({ services: null as unknown }));

vi.mock('@/lib/core', async () => {
  const core = await import('@celuneai/core');
  return {
    getCoreServices: () => holder.services,
    workspaceScope: (input: Parameters<typeof core.createScope>[0]) => core.createScope(input),
    coreErrorResponse: () => null,
  };
});

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({})),
}));

vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === 'workspace_memberships') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: { workspace_id: WORKSPACE_ID }, error: null })),
        };
      }
      if (table === 'agent_status') {
        return { upsert: vi.fn(async () => ({ error: null })) };
      }
      if (table === 'heartbeat_events') {
        return { insert: vi.fn(() => Promise.resolve({ error: null })) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

const mockGetTask = vi.fn();
const mockUpdateTask = vi.fn();
vi.mock('@repo/db/queries', () => ({
  getTask: (...args: unknown[]) => mockGetTask(...args),
  updateTask: (...args: unknown[]) => mockUpdateTask(...args),
  createActivity: vi.fn(async () => undefined),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) =>
      NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown' }, { status: 500 }),
  };
});

import { POST } from '../tasks/[id]/initiate/route';

const scope = createScope({ workspaceId: WORKSPACE_ID, orgId: ORG_ID, actorId: USER_ID });
let store: InMemoryStore;
let services: Services;

function initiate() {
  const req = new NextRequest(
    new URL(`/api/tasks/${TASK_ID}/initiate?workspace_id=${WORKSPACE_ID}`, 'http://localhost:3002'),
    { method: 'POST' },
  );
  return POST(req, { params: Promise.resolve({ id: TASK_ID }) });
}

beforeEach(() => {
  store = new InMemoryStore();
  services = createServices(store);
  holder.services = services;
  // Cloud allows ten concurrent server runs
  vi.mocked(resolveWorkspacePlan).mockResolvedValue({
    plan: 'cloud',
    isPlatformOwner: false,
  } as Awaited<ReturnType<typeof resolveWorkspacePlan>>);
  const task = {
    id: TASK_ID,
    title: 'Ship the queue',
    description: 'One queue to rule them',
    status: 'planning',
    priority: 'high',
    assignee: 'unassigned',
    project_id: null,
    workspace_id: WORKSPACE_ID,
    org_id: ORG_ID,
    metadata: {},
  };
  mockGetTask.mockResolvedValue(task);
  mockUpdateTask.mockImplementation(
    async (_c: unknown, _id: string, patch: Record<string, unknown>) => ({
      ...task,
      ...patch,
    }),
  );
});

describe('POST /api/tasks/[id]/initiate', () => {
  it('enqueues a server run that the worker can claim through JobService', async () => {
    const res = await initiate();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution_id).toBeTruthy();

    const row = store.jobRows.get(body.execution_id);
    expect(row).toMatchObject({
      runner: 'server',
      job_type: 'agent_run',
      status: 'pending',
      target_type: 'task',
      target_id: TASK_ID,
      requester_id: USER_ID,
      org_id: ORG_ID,
      priority: 5,
      token_budget: 500000,
      max_attempts: 5,
      metadata: { agent_id: 'rick', context: { task_title: 'Ship the queue' } },
    });
    expect(
      verifyJobHmac(
        {
          jobId: row!.id,
          jobType: 'agent_run',
          model: String(row!.model),
          nonce: String(row!.nonce),
          workspaceId: WORKSPACE_ID,
        },
        String(row!.job_hmac),
      ),
    ).toBe(true);

    // External agents never see server runs
    expect((await services.jobs.poll(scope)).jobs).toEqual([]);
    const serverQueue = await services.jobs.poll(scope, { runner: 'server' });
    expect(serverQueue.jobs.map((j) => j.id)).toEqual([body.execution_id]);

    // The worker claims it through the same JobService path
    const claim = await services.jobs.claim(scope, body.execution_id, { workerId: 'worker-1' });
    expect(claim.claimed).toBe(true);
    expect(store.jobRows.get(body.execution_id)).toMatchObject({
      status: 'claimed',
      worker_id: 'worker-1',
      claimed_by_key_id: null,
    });
    expect(await services.jobs.countActive(scope, 'server')).toBe(1);
  });

  it('skips the enqueue when the plan concurrency limit is reached', async () => {
    for (let i = 0; i < 10; i++) {
      store.seedJob(scope, { id: `busy-${i}`, runner: 'server', status: 'streaming' });
    }
    const res = await initiate();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution_id).toBeNull();
    expect(body.status).toBe('in_progress');
    expect(await services.jobs.countActive(scope, 'server')).toBe(10);
  });
});
