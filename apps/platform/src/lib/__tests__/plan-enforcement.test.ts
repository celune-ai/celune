/**
 * Tests for plan enforcement — the paywall decision, resolveWorkspacePlan,
 * requireActivePlan, enforcePlanLimit, isFeatureAvailable.
 *
 * Covers:
 * - decidePlan: access codes, Enterprise, active or trialing Cloud, platform owner, unpaid
 * - Legacy plan names on stored rows resolve to Cloud
 * - An unpaid org gets 402 subscription_required everywhere
 * - Cloud has no numeric limits
 * - Fail-open on errors
 * - Community edition has no paywall
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PLAN_TIERS } from '@repo/types';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockGetUserById = vi.fn();

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      admin: {
        getUserById: mockGetUserById,
      },
    },
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a chainable Supabase query mock that supports .single(), .maybeSingle(), and await */
function chain(result: { data?: unknown; count?: number | null; error?: unknown }) {
  const resolved = {
    data: result.data ?? null,
    count: result.count ?? null,
    error: result.error ?? null,
  };
  const obj: Record<string, unknown> = {
    ...resolved,
    // Make the chain thenable so `await supabase.from(...).select(...).eq(...)` works
    then: (resolve: (v: unknown) => void) => resolve(resolved),
  };
  obj.select = vi.fn().mockReturnValue(obj);
  obj.eq = vi.fn().mockReturnValue(obj);
  obj.is = vi.fn().mockReturnValue(obj);
  obj.in = vi.fn().mockReturnValue(obj);
  obj.or = vi.fn().mockReturnValue(obj);
  obj.limit = vi.fn().mockReturnValue(obj);
  obj.order = vi.fn().mockReturnValue(obj);
  obj.single = vi.fn().mockResolvedValue(resolved);
  obj.maybeSingle = vi.fn().mockResolvedValue(resolved);
  return obj;
}

interface WorkspaceSetup {
  subscription?: { plan: string; status: string; stripe_subscription_id: string | null } | null;
  /** An active code and who redeemed it (defaults to the org owner). */
  accessCode?: { plan: string; redeemedBy?: string } | null;
  platformOwnerIds?: string[];
  taskExecuted?: number;
  agentCount?: number;
  memoryCount?: number;
}

/** A workspace in org-1, owned by owner-1, with the given billing state and usage. */
function setupWorkspace(setup: WorkspaceSetup = {}) {
  const owners = new Set(setup.platformOwnerIds ?? []);
  mockGetUserById.mockImplementation(async (id: string) => ({
    data: { user: { app_metadata: owners.has(id) ? { is_platform_owner: true } : {} } },
  }));

  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case 'workspaces':
        return chain({ data: { org_id: 'org-1' } });
      case 'organizations':
        return chain({ data: { owner_id: 'owner-1' } });
      case 'access_codes': {
        // Answers only for the user the query filters on, like the real redeemed_by filter.
        const q = chain({ data: null });
        let redeemedBy: unknown;
        q.eq = vi.fn((col: string, value: unknown) => {
          if (col === 'redeemed_by') redeemedBy = value;
          return q;
        });
        const code = setup.accessCode;
        q.maybeSingle = vi.fn(async () => ({
          data:
            code && redeemedBy === (code.redeemedBy ?? 'owner-1')
              ? { id: 'code-1', plan: code.plan }
              : null,
          error: null,
        }));
        return q;
      }
      case 'subscriptions':
        return chain({ data: setup.subscription ?? null });
      case 'agent_configs':
        return chain({ data: null, count: setup.agentCount ?? 0 });
      case 'agent_memory':
        return chain({ data: null, count: setup.memoryCount ?? 0 });
      default:
        return chain({ data: null });
    }
  });

  mockRpc.mockResolvedValue({
    data: [{ event_type: 'task_executed', total: setup.taskExecuted ?? 0 }],
  });
}

const PAID = { plan: 'cloud', status: 'active', stripe_subscription_id: 'sub_1' };

// ── Import after mocks ────────────────────────────────────────────────────

import {
  decidePlan,
  enforcePlanLimit,
  resolveWorkspacePlan,
  requireActivePlan,
  isFeatureAvailable,
  getMemoryUsage,
} from '../plan-enforcement';
import { getStripe } from '../stripe';

// The paywall applies to the cloud edition; the community cases set their own edition.
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CELUNE_EDITION', 'cloud');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('decidePlan (the paywall decision)', () => {
  const none = { platformOwner: false, accessCodePlan: null, subscription: null };
  const sub = (plan: string, status: string, stripe_subscription_id: string | null = 'sub_1') => ({
    ...none,
    subscription: { plan, status, stripe_subscription_id },
  });

  it('sends an org with no subscription to the paywall', () => {
    expect(decidePlan(none)).toBe('unpaid');
  });

  it('grants Cloud for an active or trialing Stripe subscription', () => {
    expect(decidePlan(sub('cloud', 'active'))).toBe('cloud');
    expect(decidePlan(sub('cloud', 'trialing'))).toBe('cloud');
  });

  it('resolves legacy plan names on a paid subscription to Cloud', () => {
    for (const legacy of ['builder', 'pro', 'unlimited', 'team', 'build', 'free']) {
      expect(decidePlan(sub(legacy, 'active'))).toBe('cloud');
    }
  });

  it('keeps access while a payment is past due (Stripe retrying, incomplete included)', () => {
    expect(decidePlan(sub('cloud', 'past_due'))).toBe('cloud');
  });

  it('blocks canceled subscriptions (canceled, unpaid, incomplete_expired) and free-tier rows', () => {
    expect(decidePlan(sub('cloud', 'canceled'))).toBe('unpaid');
    expect(decidePlan(sub('build', 'active', null))).toBe('unpaid');
    expect(decidePlan(sub('cloud', 'past_due', null))).toBe('unpaid');
  });

  it('grants Enterprise when set by hand, without Stripe, until canceled', () => {
    expect(decidePlan(sub('enterprise', 'active', null))).toBe('enterprise');
    expect(decidePlan(sub('enterprise', 'canceled', null))).toBe('unpaid');
  });

  it('grants Cloud or Enterprise for an access code, mapping legacy code plans to Cloud', () => {
    expect(decidePlan({ ...none, accessCodePlan: 'unlimited' })).toBe('cloud');
    expect(decidePlan({ ...none, accessCodePlan: 'cloud' })).toBe('cloud');
    expect(decidePlan({ ...none, accessCodePlan: 'enterprise' })).toBe('enterprise');
  });

  it('ranks an Enterprise plan set by hand above any access code', () => {
    expect(
      decidePlan({
        ...none,
        accessCodePlan: 'cloud',
        subscription: { plan: 'enterprise', status: 'active', stripe_subscription_id: null },
      }),
    ).toBe('enterprise');
  });

  it('gives the platform owner full access without a subscription', () => {
    expect(decidePlan({ ...none, platformOwner: true })).toBe('platform_owner');
  });
});

describe('resolveWorkspacePlan', () => {
  it('returns unpaid with Cloud limits when the org owner has no subscription', async () => {
    setupWorkspace();

    const result = await resolveWorkspacePlan('ws-1', 'member-1');

    expect(result.plan).toBe('unpaid');
    expect(result.isPlatformOwner).toBe(false);
    expect(result.limits).toEqual(PLAN_TIERS.cloud);
  });

  it('flags a past-due Cloud subscription while keeping access', async () => {
    setupWorkspace({ subscription: { ...PAID, status: 'past_due' } });

    const result = await resolveWorkspacePlan('ws-1', 'member-1');

    expect(result.plan).toBe('cloud');
    expect(result.pastDue).toBe(true);
  });

  it('returns cloud for a legacy plan name on a paid subscription', async () => {
    setupWorkspace({ subscription: { ...PAID, plan: 'pro' } });

    const result = await resolveWorkspacePlan('ws-1', 'member-1');

    expect(result.plan).toBe('cloud');
    expect(result.limits).toEqual(PLAN_TIERS.cloud);
  });

  it('returns platform_owner when the requester is the platform owner', async () => {
    setupWorkspace({ platformOwnerIds: ['platform-owner'] });

    const result = await resolveWorkspacePlan('ws-1', 'platform-owner');

    expect(result.plan).toBe('platform_owner');
    expect(result.isPlatformOwner).toBe(true);
  });

  it('returns platform_owner for members of an org the platform owner owns', async () => {
    setupWorkspace({ platformOwnerIds: ['owner-1'] });

    const result = await resolveWorkspacePlan('ws-1', 'member-1');

    expect(result.plan).toBe('platform_owner');
  });

  it("does not let a member's own access code unlock the org", async () => {
    setupWorkspace({ accessCode: { plan: 'cloud', redeemedBy: 'member-1' } });

    const result = await resolveWorkspacePlan('ws-1', 'member-1');

    expect(result.plan).toBe('unpaid');
  });

  it('keeps the org on Enterprise when the owner also holds a Cloud code', async () => {
    setupWorkspace({
      accessCode: { plan: 'cloud' },
      subscription: { plan: 'enterprise', status: 'active', stripe_subscription_id: null },
    });

    expect((await resolveWorkspacePlan('ws-1', 'member-1')).plan).toBe('enterprise');
  });

  it('returns enterprise for an Enterprise access code', async () => {
    setupWorkspace({ accessCode: { plan: 'enterprise' } });

    const result = await resolveWorkspacePlan('ws-1', 'member-1');

    expect(result.plan).toBe('enterprise');
    expect(result.limits).toEqual(PLAN_TIERS.enterprise);
  });
});

describe('requireActivePlan', () => {
  it('returns 402 subscription_required for an unpaid org', async () => {
    setupWorkspace();

    const blocked = await requireActivePlan({ workspaceId: 'ws-1', userId: 'owner-1' });

    expect(blocked?.status).toBe(402);
    const body = await blocked!.json();
    expect(body.error).toBe('subscription_required');
    expect(body.upgrade_url).toBe('/subscribe');
  });

  it('allows a paid org', async () => {
    setupWorkspace({ subscription: PAID });

    expect(await requireActivePlan({ workspaceId: 'ws-1', userId: 'owner-1' })).toBeNull();
  });

  it('fails open when plan resolution errors', async () => {
    mockGetUserById.mockRejectedValue(new Error('DB connection failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await requireActivePlan({ workspaceId: 'ws-1', userId: 'user-1' })).toBeNull();
    consoleSpy.mockRestore();
  });
});

describe('enforcePlanLimit', () => {
  it('blocks every check for an unpaid org with 402', async () => {
    setupWorkspace();

    const result = await enforcePlanLimit({ workspaceId: 'ws-1', userId: 'user-1' }, 'tasks');

    expect(result?.status).toBe(402);
    expect((await result!.json()).error).toBe('subscription_required');
  });

  it('never limits Cloud, whatever the usage', async () => {
    setupWorkspace({
      subscription: PAID,
      taskExecuted: 1_000_000,
      agentCount: 500,
      memoryCount: 1_000_000,
    });
    const ctx = { workspaceId: 'ws-1', userId: 'user-1' };

    expect(await enforcePlanLimit(ctx, 'tasks')).toBeNull();
    expect(await enforcePlanLimit(ctx, 'agents')).toBeNull();
    expect(await enforcePlanLimit(ctx, 'memories')).toBeNull();
    expect(await enforcePlanLimit(ctx, 'projects')).toBeNull();
  });

  it('returns null for the platform owner', async () => {
    setupWorkspace({ platformOwnerIds: ['platform-owner'], taskExecuted: 1_000_000 });

    const result = await enforcePlanLimit(
      { workspaceId: 'ws-1', userId: 'platform-owner' },
      'tasks',
    );

    expect(result).toBeNull();
  });

  it('fails open when enforcement errors occur', async () => {
    mockGetUserById.mockRejectedValue(new Error('DB connection failed'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await enforcePlanLimit({ workspaceId: 'ws-1', userId: 'user-1' }, 'tasks');

    expect(result).toBeNull(); // allowed through
    expect(consoleSpy).toHaveBeenCalledWith(
      '[plan-enforcement] enforcePlanLimit failed, allowing request:',
      expect.objectContaining({ workspaceId: 'ws-1', check: 'tasks' }),
    );
    consoleSpy.mockRestore();
  });
});

describe('isFeatureAvailable', () => {
  it('includes every Cloud feature, BYOK among them', async () => {
    setupWorkspace({ subscription: PAID });

    expect(await isFeatureAvailable('ws-1', 'analytics')).toBe(true);
    expect(await isFeatureAvailable('ws-1', 'byok')).toBe(true);
  });

  it('keeps Enterprise-only features off Cloud', async () => {
    setupWorkspace({ subscription: PAID });

    expect(await isFeatureAvailable('ws-1', 'governance_tools')).toBe(false);
  });

  it('fails open on error', async () => {
    mockGetUserById.mockRejectedValue(new Error('DB error'));
    mockFrom.mockImplementation(() => {
      throw new Error('DB error');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await isFeatureAvailable('ws-1', 'analytics');

    expect(result).toBe(true); // fail open
    consoleSpy.mockRestore();
  });
});

describe('getMemoryUsage', () => {
  it('returns the count with no limit on Cloud', async () => {
    setupWorkspace({ subscription: PAID, memoryCount: 500 });

    const result = await getMemoryUsage('ws-1', 'user-1');

    expect(result.count).toBe(500);
    expect(result.limit).toBeNull();
    expect(result.plan).toBe('cloud');
  });
});

describe('community edition', () => {
  beforeEach(() => {
    vi.stubEnv('CELUNE_EDITION', 'community');
  });

  it('resolves every workspace to Cloud without reading subscriptions', async () => {
    setupWorkspace({ taskExecuted: 999999, agentCount: 999 });

    const result = await resolveWorkspacePlan('ws-1', 'user-1');

    expect(result.plan).toBe('cloud');
    expect(result.limits).toEqual(PLAN_TIERS.cloud);
    const tables = mockFrom.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('subscriptions');
    expect(tables).not.toContain('access_codes');
  });

  it('has no paywall', async () => {
    setupWorkspace();

    expect(await requireActivePlan({ workspaceId: 'ws-1', userId: 'user-1' })).toBeNull();
  });

  it('does not enforce plan limits', async () => {
    setupWorkspace({ taskExecuted: 999999, agentCount: 999 });

    expect(await enforcePlanLimit({ workspaceId: 'ws-1', userId: 'user-1' }, 'tasks')).toBeNull();
    expect(await enforcePlanLimit({ workspaceId: 'ws-1', userId: 'user-1' }, 'agents')).toBeNull();
  });

  it('never builds a Stripe client, even when a Stripe key is present', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_placeholder');

    expect(getStripe()).toBeNull();
  });

  it('cloud edition still paywalls an unpaid org', async () => {
    vi.stubEnv('CELUNE_EDITION', 'cloud');
    setupWorkspace();

    const blocked = await requireActivePlan({ workspaceId: 'ws-1', userId: 'user-1' });

    expect(blocked?.status).toBe(402);
  });
});
