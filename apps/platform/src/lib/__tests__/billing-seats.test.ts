import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const tables: Record<string, unknown> = {};
const mockSubscriptionUpdate = vi.fn();

/** Chainable query mock: every filter returns itself; awaiting or maybeSingle resolves the table data. */
function query(table: string) {
  const resolved = () => ({ data: tables[table] ?? null, error: null });
  const q: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(resolved()),
  };
  for (const m of ['select', 'eq', 'in']) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => resolved());
  q.update = vi.fn((values: unknown) => {
    mockSubscriptionUpdate(table, values);
    return q;
  });
  return q;
}

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({ from: (table: string) => query(table) }),
}));

const mockRetrieve = vi.fn();
const mockItemUpdate = vi.fn();
let stripeEnabled = true;

vi.mock('@/lib/stripe', () => ({
  getStripe: () =>
    stripeEnabled
      ? {
          subscriptions: { retrieve: mockRetrieve },
          subscriptionItems: { update: mockItemUpdate },
        }
      : null,
}));

import { countSeats, orgIdsForUser, syncSeats } from '../billing-seats';

beforeEach(() => {
  vi.clearAllMocks();
  stripeEnabled = true;
  for (const key of Object.keys(tables)) delete tables[key];
  tables.organizations = [{ id: 'org-1', owner_id: 'owner-1' }];
  tables.subscriptions = { stripe_subscription_id: 'sub_1' };
  mockRetrieve.mockResolvedValue({ items: { data: [{ id: 'si_1', quantity: 1 }] } });
  mockItemUpdate.mockResolvedValue({});
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('countSeats', () => {
  it('counts distinct active members across the owner orgs', async () => {
    tables.org_members = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'a' }];
    expect(await countSeats('owner-1')).toBe(2);
  });

  it('never returns fewer than one seat', async () => {
    tables.org_members = [];
    expect(await countSeats('owner-1')).toBe(1);
    tables.organizations = [];
    expect(await countSeats('owner-1')).toBe(1);
  });
});

describe('syncSeats', () => {
  it('sets the subscription quantity to the seat count with proration', async () => {
    tables.org_members = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }];

    await syncSeats('org-1');

    expect(mockRetrieve).toHaveBeenCalledWith('sub_1');
    expect(mockItemUpdate).toHaveBeenCalledWith('si_1', {
      quantity: 3,
      proration_behavior: 'create_prorations',
    });
    expect(mockSubscriptionUpdate).toHaveBeenCalledWith('subscriptions', { seats: 3 });
  });

  it('skips the Stripe update when the quantity already matches', async () => {
    tables.org_members = [{ user_id: 'a' }];

    await syncSeats(['org-1', null, 'org-1']);

    expect(mockItemUpdate).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).toHaveBeenCalledWith('subscriptions', { seats: 1 });
  });

  it('is a no-op without Stripe', async () => {
    stripeEnabled = false;

    await syncSeats('org-1');

    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(await orgIdsForUser('user-1')).toEqual([]);
  });

  it('is a no-op when the owner has no Stripe subscription', async () => {
    tables.subscriptions = null;

    await syncSeats('org-1');

    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockItemUpdate).not.toHaveBeenCalled();
  });

  it('logs and never throws when Stripe fails', async () => {
    tables.org_members = [{ user_id: 'a' }, { user_id: 'b' }];
    mockItemUpdate.mockRejectedValue(new Error('stripe down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(syncSeats('org-1')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      '[billing-seats] Seat sync failed; the member change stands:',
      expect.objectContaining({ orgIds: ['org-1'], error: 'stripe down' }),
    );
    errorSpy.mockRestore();
  });
});

describe('orgIdsForUser', () => {
  it('returns the orgs the user belongs to', async () => {
    tables.org_members = [{ org_id: 'org-1' }, { org_id: 'org-2' }];
    expect(await orgIdsForUser('user-1')).toEqual(['org-1', 'org-2']);
  });
});
