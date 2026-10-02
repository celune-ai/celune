import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMaybeSingle = vi.fn();
const mockRpc = vi.fn();
vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

const mockTrackUsage = vi.fn();
const mockTrackTrialUsage = vi.fn();
vi.mock('@/lib/track-usage', () => ({
  trackUsage: (...args: unknown[]) => mockTrackUsage(...args),
  trackTrialUsage: (...args: unknown[]) => mockTrackTrialUsage(...args),
}));

import {
  AiBudgetExceededError,
  assertWorkspaceAiBudget,
  checkRequestThrottle,
  getWorkspaceAiBudget,
  monthStart,
  recordLlmUsage,
  resetRequestThrottle,
} from '../ai-budget';

function limits(tokenLimit: number | null, rpm: number | null) {
  mockMaybeSingle.mockResolvedValue({
    data: { ai_token_limit_monthly: tokenLimit, ai_requests_per_minute: rpm },
  });
}

function usage(rows: Array<{ event_type: string; total: number | string }>) {
  mockRpc.mockResolvedValue({ data: rows, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRequestThrottle();
});

describe('monthStart', () => {
  it('returns the first instant of the UTC month', () => {
    expect(monthStart(new Date('2026-09-27T15:04:05Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });
});

describe('checkRequestThrottle', () => {
  it('allows up to the limit per sliding minute and then denies with a retry hint', () => {
    const t0 = 1_000_000;
    expect(checkRequestThrottle('ws-1', 2, t0)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(checkRequestThrottle('ws-1', 2, t0 + 10)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(checkRequestThrottle('ws-1', 2, t0 + 20)).toEqual({
      allowed: false,
      retryAfterMs: 60_000 - 20,
    });
    // Another workspace is not affected
    expect(checkRequestThrottle('ws-2', 2, t0 + 20).allowed).toBe(true);
    // Window slides
    expect(checkRequestThrottle('ws-1', 2, t0 + 60_001).allowed).toBe(true);
  });

  it('denies everything when the limit is zero', () => {
    expect(checkRequestThrottle('ws-1', 0, 5).allowed).toBe(false);
  });
});

describe('assertWorkspaceAiBudget', () => {
  it('does nothing and never sums usage when both caps are unset', async () => {
    limits(null, null);
    await expect(assertWorkspaceAiBudget('ws-1')).resolves.toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('passes under the monthly token cap', async () => {
    limits(10_000, null);
    usage([
      { event_type: 'llm_tokens', total: 4000 },
      { event_type: 'execution', total: '5999' },
      { event_type: 'tts_minutes', total: 999_999 },
    ]);
    await expect(assertWorkspaceAiBudget('ws-1')).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith(
      'sum_usage_events',
      expect.objectContaining({ p_workspace_id: 'ws-1' }),
    );
  });

  it('throws at the monthly token cap', async () => {
    limits(10_000, null);
    usage([
      { event_type: 'llm_tokens', total: 4000 },
      { event_type: 'execution', total: 6000 },
    ]);
    const err = await assertWorkspaceAiBudget('ws-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiBudgetExceededError);
    expect(err).toMatchObject({ kind: 'monthly_tokens', limit: 10_000, used: 10_000 });
  });

  it('throttles requests per minute before reading usage', async () => {
    limits(null, 1);
    await expect(assertWorkspaceAiBudget('ws-1')).resolves.toBeUndefined();
    const err = await assertWorkspaceAiBudget('ws-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiBudgetExceededError);
    expect(err).toMatchObject({ kind: 'requests_per_minute', limit: 1 });
    expect((err as AiBudgetExceededError).retryAfterMs).toBeGreaterThan(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('treats an unknown workspace as unlimited', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    await expect(assertWorkspaceAiBudget('ws-missing')).resolves.toBeUndefined();
  });
});

describe('getWorkspaceAiBudget', () => {
  it('returns limits, usage, and the period start', async () => {
    limits(500, 30);
    usage([{ event_type: 'llm_tokens', total: 120 }]);
    const budget = await getWorkspaceAiBudget('ws-1');
    expect(budget).toEqual({
      tokenLimitMonthly: 500,
      requestsPerMinute: 30,
      tokensUsedMonth: 120,
      periodStart: monthStart().toISOString(),
    });
  });
});

describe('recordLlmUsage', () => {
  it('writes an llm_tokens event and forwards the key source to the trial tracker', () => {
    recordLlmUsage({
      workspaceId: 'ws-1',
      orgId: 'org-1',
      userId: 'user-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      source: 'trial',
      feature: 'agent_chat',
      inputTokens: 100,
      outputTokens: 50,
      metadata: { agent: 'a-1' },
    });
    expect(mockTrackUsage).toHaveBeenCalledWith({
      workspace_id: 'ws-1',
      org_id: 'org-1',
      user_id: 'user-1',
      event_type: 'llm_tokens',
      quantity: 150,
      unit: 'tokens',
      metadata: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        feature: 'agent_chat',
        key_source: 'trial',
        input_tokens: 100,
        output_tokens: 50,
        agent: 'a-1',
      },
    });
    expect(mockTrackTrialUsage).toHaveBeenCalledWith('ws-1', 150, 'trial');
  });

  it('skips zero-token calls', () => {
    recordLlmUsage({
      workspaceId: 'ws-1',
      provider: 'openai',
      source: 'user_org',
      feature: 'x',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(mockTrackUsage).not.toHaveBeenCalled();
    expect(mockTrackTrialUsage).not.toHaveBeenCalled();
  });
});
