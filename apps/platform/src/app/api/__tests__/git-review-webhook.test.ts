import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

/**
 * Tests for the review_requested webhook handler that triggers /git-review.
 * Verifies that requesting `rickstrips` as reviewer logs the QA review request.
 */

// --- Mock setup ---

const mockFrom = vi.fn();
const mockInsert = vi.fn(() => Promise.resolve({ error: null }));
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockContains = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: mockFrom,
  }),
}));

vi.mock('@/lib/github-sync', () => ({
  syncReviewCommentsToTasks: vi.fn(),
}));

// Wire up query builder chain
function setupQueryChain(resolvedData: unknown = null, resolvedError: unknown = null) {
  const chain = {
    select: mockSelect,
    eq: mockEq,
    contains: mockContains,
    maybeSingle: mockMaybeSingle,
    insert: mockInsert,
    update: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: resolvedData, error: resolvedError }).then(resolve),
  };

  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockContains.mockReturnValue(chain);
  mockMaybeSingle.mockResolvedValue({ data: resolvedData, error: resolvedError });
  mockFrom.mockReturnValue(chain);
  mockInsert.mockResolvedValue({ error: null });

  return chain;
}

const WEBHOOK_SECRET = 'test-secret-123';

function signPayload(payload: string): string {
  return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;
}

function makeWebhookRequest(event: string, payload: Record<string, unknown>): NextRequest {
  const body = JSON.stringify(payload);
  return new NextRequest(new URL('http://localhost:3002/api/github/webhooks'), {
    method: 'POST',
    headers: {
      'x-github-event': event,
      'x-hub-signature-256': signPayload(body),
      'content-type': 'application/json',
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_APP_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

describe('review_requested webhook for rickstrips', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/github/webhooks/route');
    POST = mod.POST;
  });

  it('logs git_review_requested when rickstrips is requested as reviewer', async () => {
    // Setup: workspace found, no existing project_prs link
    const callLog: Array<{ table: string; args: unknown[] }> = [];
    mockFrom.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        contains: vi.fn(() => chain),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: table === 'project_prs' ? null : null,
            error: null,
          }),
        ),
        insert: vi.fn((data: unknown) => {
          callLog.push({ table, args: [data] });
          return Promise.resolve({ error: null });
        }),
        update: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        then: (resolve: (v: unknown) => void) => {
          if (table === 'workspaces') {
            return Promise.resolve({
              data: [{ id: 'ws-1', name: 'Test Workspace' }],
              error: null,
            }).then(resolve);
          }
          if (table === 'projects') {
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return chain;
    });

    const payload = {
      action: 'review_requested',
      pull_request: {
        number: 20,
        html_url: 'https://github.com/celune-ai/celune/pull/20',
        head: { ref: 'celune/rick/security-hardening', sha: 'abc123' },
        base: { ref: 'main' },
        title: 'Feat: Tenant isolation',
        draft: false,
      },
      requested_reviewer: {
        login: 'rickstrips',
        id: 12345,
      },
      repository: {
        full_name: 'celune-ai/celune',
      },
    };

    const res = await POST(makeWebhookRequest('pull_request', payload));
    expect(res.status).toBe(200);

    // Verify activity_log insert was called with git_review_requested
    const activityInserts = callLog.filter((c) => c.table === 'activity_log');
    expect(activityInserts.length).toBeGreaterThan(0);

    const insertData = activityInserts[0].args[0] as Record<string, unknown>;
    expect(insertData).toMatchObject({
      action: 'git_review_requested',
      metadata: expect.objectContaining({
        pr_number: 20,
        reviewer: 'rickstrips',
        trigger: 'webhook',
      }),
    });
  });

  it('ignores review_requested for non-rickstrips reviewers', async () => {
    const callLog: Array<{ table: string }> = [];
    mockFrom.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
        insert: vi.fn((data: unknown) => {
          callLog.push({ table });
          return Promise.resolve({ error: null });
        }),
        update: vi.fn(() => chain),
        order: vi.fn(() => chain),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        contains: vi.fn(() => chain),
      };
      return chain;
    });

    const payload = {
      action: 'review_requested',
      pull_request: {
        number: 20,
        html_url: 'https://github.com/celune-ai/celune/pull/20',
        head: { ref: 'main', sha: 'abc123' },
        base: { ref: 'main' },
        title: 'Some PR',
        draft: false,
      },
      requested_reviewer: {
        login: 'octo-reviewer',
        id: 999,
      },
      repository: {
        full_name: 'celune-ai/celune',
      },
    };

    const res = await POST(makeWebhookRequest('pull_request', payload));
    expect(res.status).toBe(200);

    // No activity_log insert for git_review_requested
    const reviewInserts = callLog.filter((c) => c.table === 'activity_log');
    // Should not have logged git_review_requested
    expect(reviewInserts).toHaveLength(0);
  });

  it('rejects requests with invalid signature', async () => {
    const payload = JSON.stringify({ action: 'review_requested' });
    const req = new NextRequest(new URL('http://localhost:3002/api/github/webhooks'), {
      method: 'POST',
      headers: {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=invalid',
        'content-type': 'application/json',
      },
      body: payload,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
