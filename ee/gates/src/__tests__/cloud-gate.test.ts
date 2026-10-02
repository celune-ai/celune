import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScope } from '@celuneai/core';
import { CloudGate, checkSuspension } from '../index.ts';

const scope = createScope({ workspaceId: 'ws-1', actorId: 'user-1' });
const planLimit = vi.fn();
const workspaceMetadata = vi.fn();
const gate = () => new CloudGate({ planLimit, workspaceMetadata });

beforeEach(() => {
  vi.clearAllMocks();
  workspaceMetadata.mockResolvedValue({});
  planLimit.mockResolvedValue(null);
});

describe('CloudGate', () => {
  it('allows task.create when the workspace is active and within limits', async () => {
    const result = await gate().check('task.create', { scope, userId: 'user-1' });
    expect(result).toEqual({ allowed: true });
    expect(workspaceMetadata).toHaveBeenCalledWith('ws-1');
    expect(planLimit).toHaveBeenCalledWith({ workspaceId: 'ws-1', userId: 'user-1' }, 'tasks');
  });

  it('maps project.create and api_key.create to their limits', async () => {
    await gate().check('project.create', { scope });
    expect(planLimit).toHaveBeenLastCalledWith(
      { workspaceId: 'ws-1', userId: undefined },
      'projects',
    );
    await gate().check('api_key.create', { scope });
    expect(planLimit).toHaveBeenLastCalledWith(
      { workspaceId: 'ws-1', userId: undefined },
      'api_calls',
    );
  });

  it('skips the plan check for ungated features but still checks suspension', async () => {
    const result = await gate().check('agent.run', { scope });
    expect(result).toEqual({ allowed: true });
    expect(workspaceMetadata).toHaveBeenCalledTimes(1);
    expect(planLimit).not.toHaveBeenCalled();
  });

  it('carries the plan denial body, status, and upgrade url', async () => {
    const body = { error: 'plan_limit', limit: 'max_tasks', upgrade_url: '/settings?tab=billing' };
    planLimit.mockResolvedValue({ status: 403, body });
    const result = await gate().check('task.create', { scope });
    expect(result).toEqual({
      allowed: false,
      reason: 'plan_limit',
      status: 403,
      upgradeUrl: '/settings?tab=billing',
      details: body,
    });
  });

  it('denies a suspended workspace before consulting the plan', async () => {
    workspaceMetadata.mockResolvedValue({ suspended_at: '2026-01-01T00:00:00Z' });
    const result = await gate().check('task.create', { scope });
    expect(result).toMatchObject({
      allowed: false,
      reason: 'workspace_suspended',
      status: 403,
      details: { error: 'workspace_suspended', suspended_at: '2026-01-01T00:00:00Z' },
    });
    expect(planLimit).not.toHaveBeenCalled();
  });

  it('allows provider.fallback_key while trial budget remains and without a trial reader', async () => {
    expect(await gate().check('provider.fallback_key', { scope })).toEqual({ allowed: true });
    const trialBudget = vi.fn().mockResolvedValue({ budget: 50000, used: 100 });
    const withTrial = new CloudGate({ planLimit, workspaceMetadata, trialBudget });
    expect(await withTrial.check('provider.fallback_key', { scope })).toEqual({ allowed: true });
    expect(trialBudget).toHaveBeenCalledWith('ws-1');
    expect(planLimit).not.toHaveBeenCalled();
  });

  it('denies provider.fallback_key with 402 once the trial budget is used up', async () => {
    const trialBudget = vi.fn().mockResolvedValue({ budget: 50000, used: 50000 });
    const withTrial = new CloudGate({ planLimit, workspaceMetadata, trialBudget });
    expect(await withTrial.check('provider.fallback_key', { scope })).toEqual({
      allowed: false,
      reason: 'trial_exhausted',
      status: 402,
      details: { error: 'trial_exhausted', budget: 50000, used: 50000 },
    });
  });

  it('checks suspension before the trial budget', async () => {
    workspaceMetadata.mockResolvedValue({ suspended_at: '2026-01-01T00:00:00Z' });
    const trialBudget = vi.fn();
    const withTrial = new CloudGate({ planLimit, workspaceMetadata, trialBudget });
    const result = await withTrial.check('provider.fallback_key', { scope });
    expect(result).toMatchObject({ allowed: false, reason: 'workspace_suspended' });
    expect(trialBudget).not.toHaveBeenCalled();
  });
});

describe('CloudGate paywall', () => {
  const body = {
    error: 'subscription_required',
    message: 'Subscribe to continue.',
    upgrade_url: '/subscribe',
  };
  const paywall = vi.fn();
  const trialBudget = vi.fn();
  const paid = () => new CloudGate({ planLimit, workspaceMetadata, paywall, trialBudget });

  beforeEach(() => {
    paywall.mockResolvedValue(null);
    trialBudget.mockResolvedValue({ budget: 100, used: 0 });
  });

  it.each([
    'workspace.access',
    'task.create',
    'project.create',
    'job.enqueue',
    'agent.run',
    'member.invite',
    'api_key.create',
    'provider.fallback_key',
  ] as const)('denies %s with 402 when the org is unpaid', async (feature) => {
    paywall.mockResolvedValue({ status: 402, body });

    const result = await paid().check(feature, { scope, userId: 'user-1' });

    expect(result).toEqual({
      allowed: false,
      reason: 'subscription_required',
      status: 402,
      upgradeUrl: '/subscribe',
      details: body,
    });
    expect(paywall).toHaveBeenCalledWith({ workspaceId: 'ws-1', userId: 'user-1' });
    expect(planLimit).not.toHaveBeenCalled();
    expect(trialBudget).not.toHaveBeenCalled();
  });

  it('allows a paid org and still applies the feature check', async () => {
    expect(await paid().check('agent.run', { scope })).toEqual({ allowed: true });
    await paid().check('task.create', { scope });
    expect(planLimit).toHaveBeenCalledWith({ workspaceId: 'ws-1', userId: undefined }, 'tasks');
  });

  it('checks suspension before the paywall', async () => {
    workspaceMetadata.mockResolvedValue({ suspended_at: '2026-01-01T00:00:00Z' });
    paywall.mockResolvedValue({ status: 402, body });

    const result = await paid().check('workspace.access', { scope });

    expect(result).toMatchObject({ allowed: false, reason: 'workspace_suspended' });
    expect(paywall).not.toHaveBeenCalled();
  });

  it('reports every feature as plan limited when a paywall is set', () => {
    expect(paid().describe('workspace.access')).toBe('plan_limited');
    expect(paid().describe('agent.run')).toBe('plan_limited');
    expect(gate().describe('workspace.access')).toBe('open');
  });
});

describe('CloudGate.describe', () => {
  it('reports plan limits and the trial meter per feature', () => {
    const withTrial = new CloudGate({ planLimit, workspaceMetadata, trialBudget: vi.fn() });
    expect(withTrial.describe('task.create')).toBe('plan_limited');
    expect(withTrial.describe('api_key.create')).toBe('plan_limited');
    expect(withTrial.describe('agent.run')).toBe('open');
    expect(withTrial.describe('provider.fallback_key')).toBe('metered');
    expect(new CloudGate({ planLimit, workspaceMetadata }).describe('provider.fallback_key')).toBe(
      'open',
    );
  });
});

describe('checkSuspension', () => {
  it('allows when metadata is missing or has no suspended_at', async () => {
    expect(await checkSuspension(async () => null, 'ws-1')).toEqual({ allowed: true });
    expect(await checkSuspension(async () => ({ other: 1 }), 'ws-1')).toEqual({ allowed: true });
  });

  it('fails closed with 503 when the read throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await checkSuspension(async () => {
      throw new Error('db down');
    }, 'ws-1');
    expect(result).toEqual({
      allowed: false,
      reason: 'suspension_unverified',
      status: 503,
      details: { error: 'Unable to verify workspace status. Please try again.' },
    });
    spy.mockRestore();
  });
});
