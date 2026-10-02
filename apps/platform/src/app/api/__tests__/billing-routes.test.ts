/**
 * Tests for billing routes: webhook, checkout, portal.
 * Checkout sells one Cloud price per interval with quantity = seats; Enterprise has no checkout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'billing-user-001';

// ---------------------------------------------------------------------------
// Mock: auth
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(() => TEST_USER_ID),
}));

// ---------------------------------------------------------------------------
// Mock: CSRF
// ---------------------------------------------------------------------------

vi.mock('@/lib/csrf', () => ({
  validateOrigin: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Mock: api-error
// ---------------------------------------------------------------------------

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: rate-limiter
// ---------------------------------------------------------------------------

vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: { limit: 60, windowMs: 60000 },
}));

// ---------------------------------------------------------------------------
// Mock: parse-body
// ---------------------------------------------------------------------------

vi.mock('@/lib/parse-body', () => ({
  parseBody: vi.fn(async (req: NextRequest, schema: { parse: (v: unknown) => unknown }) =>
    schema.parse(await req.clone().json()),
  ),
  isErrorResponse: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Mock: seats
// ---------------------------------------------------------------------------

const mockCountSeats = vi.fn(async () => 3);

vi.mock('@/lib/billing-seats', () => ({
  countSeats: (...args: unknown[]) => mockCountSeats(...(args as [])),
}));

// ---------------------------------------------------------------------------
// Mock: Stripe
// ---------------------------------------------------------------------------

const mockStripeConstructEvent = vi.fn();
const mockStripeSubsRetrieve = vi.fn();
const mockStripeCheckoutCreate = vi.fn();
const mockStripePortalCreate = vi.fn();
const mockStripeCustomersCreate = vi.fn();

vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(() => ({
    webhooks: { constructEvent: mockStripeConstructEvent },
    subscriptions: { retrieve: mockStripeSubsRetrieve },
    checkout: { sessions: { create: mockStripeCheckoutCreate } },
    billingPortal: { sessions: { create: mockStripePortalCreate } },
    customers: { create: mockStripeCustomersCreate },
  })),
  cloudPriceId: vi.fn((interval: string) =>
    interval === 'year' ? 'price_cloud_year' : 'price_cloud_month',
  ),
  priceIdToPlan: vi.fn((id: string) => (id.startsWith('price_cloud') ? 'cloud' : null)),
}));

// ---------------------------------------------------------------------------
// Mock: Supabase
// ---------------------------------------------------------------------------

const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockUpdateEq = vi.fn();
/** update().eq(...) resolves, and can chain a second .eq(...). */
const updateChain = () => {
  const result = Promise.resolve({ error: null }) as Promise<{ error: null }> & {
    eq: typeof mockUpdateEq;
  };
  result.eq = mockUpdateEq;
  return result;
};
mockUpdateEq.mockImplementation(updateChain);
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
const mockSelect = vi.fn(() => ({
  eq: vi.fn(() => ({ single: mockSingle, maybeSingle: mockSingle })),
}));

/** The org the caller owns, if any; checkout refuses callers who own none. */
let ownedOrg: { id: string } | null = { id: 'org-1' };
const organizationsQuery = () => {
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.eq = vi.fn(() => q);
  q.limit = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data: ownedOrg, error: null }));
  return q;
};

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) =>
      table === 'organizations'
        ? organizationsQuery()
        : { upsert: mockUpsert, update: mockUpdate, select: mockSelect },
    ),
  })),
}));

vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: TEST_USER_ID, email: 'test@example.com' } },
        error: null,
      })),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postJson(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } as never);
}

function postText(url: string, text: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...headers },
    body: text,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  ownedOrg = { id: 'org-1' };
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
});

// ---------------------------------------------------------------------------
// Tests: POST /api/billing/webhook
// ---------------------------------------------------------------------------

describe('POST /api/billing/webhook', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/billing/webhook/route');
    POST = mod.POST;
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const req = postText('http://localhost:3002/api/billing/webhook', '{}');
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('signature');
  });

  it('returns 400 on invalid signature', async () => {
    mockStripeConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const req = postText('http://localhost:3002/api/billing/webhook', '{}', {
      'stripe-signature': 'sig_bad',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('handles subscription.created event', async () => {
    const subData = {
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      metadata: { user_id: TEST_USER_ID },
      items: {
        data: [
          {
            price: { id: 'price_cloud_year', recurring: { interval: 'year' } },
            quantity: 4,
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };

    mockStripeConstructEvent.mockReturnValue({
      type: 'customer.subscription.created',
      data: { object: subData },
    });

    const req = postText('http://localhost:3002/api/billing/webhook', '{}', {
      'stripe-signature': 'sig_valid',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: TEST_USER_ID,
        plan: 'cloud',
        seats: 4,
        billing_interval: 'year',
        status: 'active',
      }),
      { onConflict: 'user_id' },
    );
  });

  it.each([
    ['current', { parent: { subscription_details: { subscription: 'sub_9' } } }],
    ['legacy', { subscription: 'sub_9' }],
  ])(
    'marks the subscription past_due on invoice.payment_failed (%s payload)',
    async (_, fields) => {
      mockStripeConstructEvent.mockReturnValue({
        type: 'invoice.payment_failed',
        data: { object: { id: 'in_1', ...fields } },
      });
      mockStripeSubsRetrieve.mockResolvedValue({
        id: 'sub_9',
        metadata: { user_id: TEST_USER_ID },
      });

      const req = postText('http://localhost:3002/api/billing/webhook', '{}', {
        'stripe-signature': 'sig_valid',
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockStripeSubsRetrieve).toHaveBeenCalledWith('sub_9');
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'past_due' });
    },
  );

  it.each([
    ['active', 'active'],
    ['trialing', 'active'],
    ['past_due', 'past_due'],
    ['incomplete', 'past_due'],
    ['incomplete_expired', 'canceled'],
    ['unpaid', 'canceled'],
    ['canceled', 'canceled'],
  ])('stores Stripe status %s as %s', async (stripeStatus, stored) => {
    mockStripeConstructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: stripeStatus,
          metadata: { user_id: TEST_USER_ID },
          items: { data: [{ price: { id: 'price_cloud_month' }, quantity: 1 }] },
        },
      },
    });

    const res = await POST(
      postText('http://localhost:3002/api/billing/webhook', '{}', { 'stripe-signature': 'sig' }),
    );

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ status: stored }), {
      onConflict: 'user_id',
    });
  });

  it('stores nothing for a subscription on an unknown price', async () => {
    mockStripeConstructEvent.mockReturnValue({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_x',
          customer: 'cus_x',
          status: 'active',
          metadata: { user_id: TEST_USER_ID },
          items: { data: [{ price: { id: 'price_someone_else' }, quantity: 1 }] },
        },
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(
      postText('http://localhost:3002/api/billing/webhook', '{}', { 'stripe-signature': 'sig' }),
    );

    expect(res.status).toBe(200);
    expect(mockUpsert).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('answers 500 when the subscription write fails, so Stripe retries', async () => {
    mockStripeConstructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          metadata: { user_id: TEST_USER_ID },
          items: { data: [{ price: { id: 'price_cloud_month' }, quantity: 2 }] },
        },
      },
    });
    mockUpsert.mockResolvedValueOnce({ error: { message: 'connection reset' } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(
      postText('http://localhost:3002/api/billing/webhook', '{}', { 'stripe-signature': 'sig' }),
    );

    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });

  it('handles subscription.deleted event', async () => {
    mockStripeConstructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          metadata: { user_id: TEST_USER_ID },
          items: { data: [] },
        },
      },
    });

    const req = postText('http://localhost:3002/api/billing/webhook', '{}', {
      'stripe-signature': 'sig_valid',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'cloud', status: 'canceled', stripe_subscription_id: null }),
    );
    expect(mockUpdateEq).toHaveBeenCalledWith('user_id', TEST_USER_ID);
    expect(mockUpdateEq).toHaveBeenCalledWith('stripe_subscription_id', 'sub_123');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/billing/checkout
// ---------------------------------------------------------------------------

describe('POST /api/billing/checkout', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/billing/checkout/route');
    POST = mod.POST;
  });

  it('checks out the monthly Cloud price with one unit per seat by default', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { stripe_customer_id: 'cus_existing' },
      error: null,
    });
    mockStripeCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session_123' });

    const res = await POST(postJson('http://localhost:3002/api/billing/checkout', {}));

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://checkout.stripe.com/session_123');
    expect(mockCountSeats).toHaveBeenCalledWith(TEST_USER_ID);
    const [session, options] = mockStripeCheckoutCreate.mock.calls[0];
    expect(options.idempotencyKey).toMatch(
      new RegExp(`^cloud-checkout:${TEST_USER_ID}:\\d+:[0-9a-f]{32}$`),
    );
    expect(session.customer).toBe('cus_existing');
    expect(session.line_items).toEqual([{ price: 'price_cloud_month', quantity: 3 }]);
    expect(session.subscription_data.metadata).toEqual({ user_id: TEST_USER_ID, plan: 'cloud' });
  });

  it('checks out the annual Cloud price for interval year', async () => {
    mockCountSeats.mockResolvedValueOnce(1);
    mockStripeCustomersCreate.mockResolvedValue({ id: 'cus_new' });
    mockStripeCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session_456' });

    const res = await POST(
      postJson('http://localhost:3002/api/billing/checkout', { interval: 'year' }),
    );

    expect(res.status).toBe(200);
    const session = mockStripeCheckoutCreate.mock.calls[0][0];
    expect(session.customer).toBe('cus_new');
    expect(mockStripeCustomersCreate.mock.calls[0][1].idempotencyKey).toMatch(
      new RegExp(`^cloud-customer:${TEST_USER_ID}:`),
    );
    expect(session.line_items).toEqual([{ price: 'price_cloud_year', quantity: 1 }]);
  });

  it('refuses Enterprise with a contact-sales 400', async () => {
    const res = await POST(
      postJson('http://localhost:3002/api/billing/checkout', { plan: 'enterprise' }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('contact_sales');
    expect(body.error).toContain('hello@celune.ai');
    expect(mockStripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it('refuses a caller who owns no org, since only the org owner pays', async () => {
    ownedOrg = null;

    const res = await POST(postJson('http://localhost:3002/api/billing/checkout', {}));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('not_org_owner');
    expect(mockStripeCheckoutCreate).not.toHaveBeenCalled();
    expect(mockStripeCustomersCreate).not.toHaveBeenCalled();
  });

  it('refuses a second subscription with 409', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'active' },
      error: null,
    });

    const res = await POST(postJson('http://localhost:3002/api/billing/checkout', {}));

    expect(res.status).toBe(409);
    expect(mockStripeCheckoutCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/billing/portal
// ---------------------------------------------------------------------------

describe('POST /api/billing/portal', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/billing/portal/route');
    POST = mod.POST;
  });

  it('returns 404 when no billing account exists', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = postJson('http://localhost:3002/api/billing/portal', {});
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns portal URL when customer exists', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { stripe_customer_id: 'cus_existing' },
      error: null,
    });
    mockStripePortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/portal_123' });

    const req = postJson('http://localhost:3002/api/billing/portal', {});
    const res = await POST(req);
    expect(res.status).toBeLessThan(500);
  });
});
