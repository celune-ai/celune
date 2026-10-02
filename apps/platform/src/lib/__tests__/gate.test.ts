import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { NoopGate, createScope } from '@celuneai/core';
import { CloudGate } from '@celuneai/ee-gates';

const mockEnforcePlanLimit = vi.fn();
const mockRequireActivePlan = vi.fn();
vi.mock('@/lib/plan-enforcement', () => ({
  enforcePlanLimit: (...args: unknown[]) => mockEnforcePlanLimit(...args),
  requireActivePlan: (...args: unknown[]) => mockRequireActivePlan(...args),
}));

const mockSingle = vi.fn();
vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: mockSingle }) }) }),
  }),
}));

import { createPlatformGate } from '../gate';

const scope = createScope({ workspaceId: 'ws-1', actorId: 'user-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockSingle.mockResolvedValue({ data: { metadata: {} } });
  mockEnforcePlanLimit.mockResolvedValue(null);
  mockRequireActivePlan.mockResolvedValue(null);
});

describe('createPlatformGate', () => {
  it('returns NoopGate for the community edition and never touches billing', async () => {
    const gate = createPlatformGate({});
    expect(gate).toBeInstanceOf(NoopGate);
    expect(await gate.check('task.create', { scope })).toEqual({ allowed: true });
    expect(mockEnforcePlanLimit).not.toHaveBeenCalled();
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it('honours an explicit CELUNE_GATE_MODE', () => {
    expect(createPlatformGate({ CELUNE_GATE_MODE: 'cloud' })).toBeInstanceOf(CloudGate);
    expect(createPlatformGate({ STRIPE_SECRET_KEY: 'x', CELUNE_GATE_MODE: 'noop' })).toBeInstanceOf(
      NoopGate,
    );
  });

  it('selects the cloud gate when billing is configured', () => {
    expect(createPlatformGate({ STRIPE_SECRET_KEY: 'x' })).toBeInstanceOf(CloudGate);
  });

  it('cloud gate calls plan enforcement with the same arguments as before', async () => {
    const gate = createPlatformGate({ CELUNE_GATE_MODE: 'cloud' });
    expect(await gate.check('task.create', { scope, userId: 'user-1' })).toEqual({ allowed: true });
    expect(mockEnforcePlanLimit).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', userId: 'user-1' },
      'tasks',
    );
    await gate.check('project.create', { scope });
    expect(mockEnforcePlanLimit).toHaveBeenLastCalledWith(
      { workspaceId: 'ws-1', userId: undefined },
      'projects',
    );
  });

  it('cloud gate carries the plan denial body and status', async () => {
    const body = { error: 'plan_limit', limit: 'max_tasks', upgrade_url: '/settings?tab=billing' };
    mockEnforcePlanLimit.mockResolvedValue(NextResponse.json(body, { status: 403 }));
    const result = await createPlatformGate({ CELUNE_GATE_MODE: 'cloud' }).check('task.create', {
      scope,
    });
    expect(result).toEqual({
      allowed: false,
      reason: 'plan_limit',
      status: 403,
      upgradeUrl: '/settings?tab=billing',
      details: body,
    });
  });

  it('cloud gate blocks a suspended workspace with the original response body', async () => {
    mockSingle.mockResolvedValue({ data: { metadata: { suspended_at: '2026-01-01T00:00:00Z' } } });
    const result = await createPlatformGate({ CELUNE_GATE_MODE: 'cloud' }).check('task.create', {
      scope,
    });
    expect(result).toMatchObject({
      allowed: false,
      status: 403,
      details: { error: 'workspace_suspended', suspended_at: '2026-01-01T00:00:00Z' },
    });
    expect(mockEnforcePlanLimit).not.toHaveBeenCalled();
  });

  it('cloud gate denies every feature of an unpaid org, API reads and the host key included', async () => {
    const body = {
      error: 'subscription_required',
      message: 'Subscribe to continue.',
      upgrade_url: '/subscribe',
    };
    mockRequireActivePlan.mockResolvedValue(NextResponse.json(body, { status: 402 }));
    const unpaid = createScope({ workspaceId: 'ws-unpaid', actorId: 'user-9' });
    const gate = createPlatformGate({ CELUNE_GATE_MODE: 'cloud' });

    for (const feature of ['workspace.access', 'agent.run', 'provider.fallback_key'] as const) {
      expect(await gate.check(feature, { scope: unpaid, userId: 'user-9' })).toMatchObject({
        allowed: false,
        status: 402,
        reason: 'subscription_required',
      });
    }
    // One plan resolution per workspace and caller within the cache window.
    expect(mockRequireActivePlan).toHaveBeenCalledTimes(1);
    expect(mockRequireActivePlan).toHaveBeenCalledWith({
      workspaceId: 'ws-unpaid',
      userId: 'user-9',
    });
  });
});
