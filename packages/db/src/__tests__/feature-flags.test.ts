import { describe, expect, it } from 'vitest';
import { evaluateFlag, matchesConditions, evaluateCondition, isInRollout } from '../feature-flags';
import type { FeatureFlag, FlagCondition, FlagEvaluationContext } from '@repo/types';

// ── Helpers ──

function makeFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    id: 'test-flag-id',
    key: 'test-flag',
    name: 'Test Flag',
    description: null,
    flag_type: 'boolean',
    enabled: true,
    variants: [],
    payload: null,
    rules: [],
    default_variant: null,
    tags: [],
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<FlagEvaluationContext> = {}): FlagEvaluationContext {
  return {
    userId: 'user-123',
    email: 'test@example.com',
    plan: 'pro',
    ...overrides,
  };
}

// ── evaluateFlag ──

describe('evaluateFlag', () => {
  it('returns false for disabled boolean flag', () => {
    const flag = makeFlag({ enabled: false });
    expect(evaluateFlag(flag, makeContext())).toBe(false);
  });

  it('returns null for disabled multivariate flag', () => {
    const flag = makeFlag({ enabled: false, flag_type: 'multivariate' });
    expect(evaluateFlag(flag, makeContext())).toBeNull();
  });

  it('returns true for enabled boolean flag with no rules', () => {
    const flag = makeFlag({ enabled: true, rules: [] });
    expect(evaluateFlag(flag, makeContext())).toBe(true);
  });

  it('returns payload for enabled remote_config flag', () => {
    const flag = makeFlag({
      flag_type: 'remote_config',
      enabled: true,
      payload: { theme: 'dark', maxItems: 10 },
    });
    expect(evaluateFlag(flag, makeContext())).toEqual({ theme: 'dark', maxItems: 10 });
  });

  it('returns null for remote_config with no payload', () => {
    const flag = makeFlag({ flag_type: 'remote_config', enabled: true, payload: null });
    expect(evaluateFlag(flag, makeContext())).toBeNull();
  });

  it('evaluates rules top-to-bottom, first match wins', () => {
    const flag = makeFlag({
      flag_type: 'multivariate',
      rules: [
        {
          id: 'r1',
          conditions: [{ property: 'email', operator: 'ends_with', value: '@celune.ai' }],
          rollout_percentage: 100,
          variant: 'internal',
        },
        {
          id: 'r2',
          conditions: [],
          rollout_percentage: 100,
          variant: 'public',
        },
      ],
      default_variant: 'control',
    });

    // Email matches first rule
    expect(evaluateFlag(flag, makeContext({ email: 'eric@celune.ai' }))).toBe('internal');

    // Email doesn't match first rule, falls to second
    expect(evaluateFlag(flag, makeContext({ email: 'user@gmail.com' }))).toBe('public');
  });

  it('returns false when rules exist but none match', () => {
    const flag = makeFlag({
      rules: [
        {
          id: 'r1',
          conditions: [{ property: 'email', operator: 'equals', value: 'admin@test.com' }],
          rollout_percentage: 100,
        },
      ],
    });
    expect(evaluateFlag(flag, makeContext({ email: 'other@test.com' }))).toBe(false);
  });

  it('returns default_variant for multivariate when no rules match', () => {
    const flag = makeFlag({
      flag_type: 'multivariate',
      rules: [
        {
          id: 'r1',
          conditions: [{ property: 'email', operator: 'equals', value: 'nobody@test.com' }],
          rollout_percentage: 100,
          variant: 'test',
        },
      ],
      default_variant: 'control',
    });
    expect(evaluateFlag(flag, makeContext())).toBe('control');
  });
});

// ── evaluateCondition ──

describe('evaluateCondition', () => {
  const ctx = makeContext({ email: 'eric@celune.ai', plan: 'pro', userId: 'user-123' });

  it('equals', () => {
    expect(evaluateCondition({ property: 'plan', operator: 'equals', value: 'pro' }, ctx)).toBe(
      true,
    );
    expect(evaluateCondition({ property: 'plan', operator: 'equals', value: 'free' }, ctx)).toBe(
      false,
    );
  });

  it('not_equals', () => {
    expect(
      evaluateCondition({ property: 'plan', operator: 'not_equals', value: 'free' }, ctx),
    ).toBe(true);
    expect(evaluateCondition({ property: 'plan', operator: 'not_equals', value: 'pro' }, ctx)).toBe(
      false,
    );
  });

  it('contains', () => {
    expect(
      evaluateCondition({ property: 'email', operator: 'contains', value: 'celune' }, ctx),
    ).toBe(true);
    expect(
      evaluateCondition({ property: 'email', operator: 'contains', value: 'gmail' }, ctx),
    ).toBe(false);
  });

  it('not_contains', () => {
    expect(
      evaluateCondition({ property: 'email', operator: 'not_contains', value: 'gmail' }, ctx),
    ).toBe(true);
  });

  it('starts_with', () => {
    expect(
      evaluateCondition({ property: 'email', operator: 'starts_with', value: 'eric' }, ctx),
    ).toBe(true);
    expect(
      evaluateCondition({ property: 'email', operator: 'starts_with', value: 'admin' }, ctx),
    ).toBe(false);
  });

  it('ends_with', () => {
    expect(
      evaluateCondition({ property: 'email', operator: 'ends_with', value: '@celune.ai' }, ctx),
    ).toBe(true);
    expect(
      evaluateCondition({ property: 'email', operator: 'ends_with', value: '@gmail.com' }, ctx),
    ).toBe(false);
  });

  it('in', () => {
    expect(
      evaluateCondition({ property: 'plan', operator: 'in', value: ['pro', 'enterprise'] }, ctx),
    ).toBe(true);
    expect(
      evaluateCondition({ property: 'plan', operator: 'in', value: ['free', 'basic'] }, ctx),
    ).toBe(false);
  });

  it('not_in', () => {
    expect(
      evaluateCondition({ property: 'plan', operator: 'not_in', value: ['free', 'basic'] }, ctx),
    ).toBe(true);
    expect(evaluateCondition({ property: 'plan', operator: 'not_in', value: ['pro'] }, ctx)).toBe(
      false,
    );
  });

  it('gt / lt / gte / lte', () => {
    const numCtx = makeContext({ score: 75 } as Record<string, unknown> as FlagEvaluationContext);
    expect(evaluateCondition({ property: 'score', operator: 'gt', value: 50 }, numCtx)).toBe(true);
    expect(evaluateCondition({ property: 'score', operator: 'gt', value: 100 }, numCtx)).toBe(
      false,
    );
    expect(evaluateCondition({ property: 'score', operator: 'lt', value: 100 }, numCtx)).toBe(true);
    expect(evaluateCondition({ property: 'score', operator: 'gte', value: 75 }, numCtx)).toBe(true);
    expect(evaluateCondition({ property: 'score', operator: 'lte', value: 75 }, numCtx)).toBe(true);
  });

  it('is_set / is_not_set', () => {
    expect(evaluateCondition({ property: 'email', operator: 'is_set', value: '' }, ctx)).toBe(true);
    expect(evaluateCondition({ property: 'nonexistent', operator: 'is_set', value: '' }, ctx)).toBe(
      false,
    );
    expect(
      evaluateCondition({ property: 'nonexistent', operator: 'is_not_set', value: '' }, ctx),
    ).toBe(true);
  });

  it('is_true / is_false', () => {
    const boolCtx = makeContext({ beta: true } as Record<string, unknown> as FlagEvaluationContext);
    expect(evaluateCondition({ property: 'beta', operator: 'is_true', value: '' }, boolCtx)).toBe(
      true,
    );
    expect(evaluateCondition({ property: 'beta', operator: 'is_false', value: '' }, boolCtx)).toBe(
      false,
    );
  });

  it('returns false for missing property (non-presence operators)', () => {
    expect(evaluateCondition({ property: 'missing', operator: 'equals', value: 'test' }, ctx)).toBe(
      false,
    );
  });
});

// ── matchesConditions ──

describe('matchesConditions', () => {
  it('returns true when all conditions match (AND logic)', () => {
    const conditions: FlagCondition[] = [
      { property: 'email', operator: 'ends_with', value: '@celune.ai' },
      { property: 'plan', operator: 'equals', value: 'pro' },
    ];
    expect(
      matchesConditions(conditions, makeContext({ email: 'eric@celune.ai', plan: 'pro' })),
    ).toBe(true);
  });

  it('returns false when any condition fails', () => {
    const conditions: FlagCondition[] = [
      { property: 'email', operator: 'ends_with', value: '@celune.ai' },
      { property: 'plan', operator: 'equals', value: 'enterprise' },
    ];
    expect(
      matchesConditions(conditions, makeContext({ email: 'eric@celune.ai', plan: 'pro' })),
    ).toBe(false);
  });

  it('returns true for empty conditions array', () => {
    expect(matchesConditions([], makeContext())).toBe(true);
  });
});

// ── isInRollout ──

describe('isInRollout', () => {
  it('returns true for 100% rollout', () => {
    expect(isInRollout(100, 'any-user', 'any-flag')).toBe(true);
  });

  it('returns false for 0% rollout', () => {
    expect(isInRollout(0, 'any-user', 'any-flag')).toBe(false);
  });

  it('is deterministic — same user+flag always gets same result', () => {
    const result1 = isInRollout(50, 'user-abc', 'dark-mode');
    const result2 = isInRollout(50, 'user-abc', 'dark-mode');
    const result3 = isInRollout(50, 'user-abc', 'dark-mode');
    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  it('different users get different buckets', () => {
    // With enough users, some should be in and some out at 50%
    let inCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (isInRollout(50, `user-${i}`, 'test-flag')) inCount++;
    }
    // Should be roughly 500 +/- 50 (within 5%)
    expect(inCount).toBeGreaterThan(400);
    expect(inCount).toBeLessThan(600);
  });

  it('higher percentage includes more users', () => {
    let count10 = 0;
    let count90 = 0;
    for (let i = 0; i < 1000; i++) {
      if (isInRollout(10, `user-${i}`, 'test-flag')) count10++;
      if (isInRollout(90, `user-${i}`, 'test-flag')) count90++;
    }
    expect(count90).toBeGreaterThan(count10);
  });
});
