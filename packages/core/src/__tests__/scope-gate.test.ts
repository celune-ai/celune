import { describe, expect, it } from 'vitest';
import { GateDenied, isCoreError } from '../errors.ts';
import { NoopGate } from '../gate.ts';
import { createScope, isUuid } from '../scope.ts';
import { createServices } from '../services.ts';
import { InMemoryStore } from '../testing/memory-store.ts';

describe('createScope', () => {
  it('freezes the scope and defaults org and actor to null', () => {
    const scope = createScope({ workspaceId: 'ws' });
    expect(scope).toEqual({ workspaceId: 'ws', orgId: null, actorId: null });
    expect(Object.isFrozen(scope)).toBe(true);
  });

  it('refuses an empty workspace id', () => {
    expect(() => createScope({ workspaceId: '' })).toThrow(/workspaceId/);
  });

  it('detects uuids', () => {
    expect(isUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    expect(isUuid('rick')).toBe(false);
  });
});

describe('NoopGate', () => {
  it('allows every feature', async () => {
    const gate = new NoopGate();
    const scope = createScope({ workspaceId: 'ws' });
    for (const feature of ['task.create', 'project.create', 'job.enqueue'] as const) {
      expect(await gate.check(feature, { scope })).toEqual({ allowed: true });
    }
  });
});

describe('GateDenied', () => {
  it('carries status, reason, and upgrade url', () => {
    const error = new GateDenied('task.create', 'plan_limit', {
      status: 402,
      upgradeUrl: '/billing',
    });
    expect(error.status).toBe(402);
    expect(error.feature).toBe('task.create');
    expect(error.upgradeUrl).toBe('/billing');
    expect(isCoreError(error)).toBe(true);
    expect(isCoreError(new Error('x'))).toBe(false);
  });
});

describe('createServices', () => {
  it('wires all four services over one store with a no-op gate by default', async () => {
    const store = new InMemoryStore();
    const services = createServices(store);
    expect(services.gate).toBeInstanceOf(NoopGate);
    const scope = createScope({ workspaceId: 'ws' });
    const task = await services.tasks.create(scope, { title: 'x' }, { source: 'test' });
    expect(task.workspace_id).toBe('ws');
    expect(await services.projects.list(scope)).toEqual([]);
    expect(await services.agents.listStatus(scope)).toEqual([]);
    expect(await services.jobs.nextPending(scope)).toBeNull();
  });
});
