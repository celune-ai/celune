import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------- Mock setup ----------

const mockFrom = vi.fn();

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock('@repo/db/queries', () => ({
  createActivity: vi.fn(async () => ({})),
}));

vi.mock('@repo/notifications/decrypt-webhook', () => ({
  decryptBotToken: vi.fn(() => 'xoxb-fake-bot-token'),
}));

vi.mock('@/lib/slack-home-tab', () => ({
  publishHomeTab: vi.fn(async () => ({})),
}));

vi.mock('@/lib/slack-agent-reply', () => ({
  handleAgentReply: vi.fn(async () => {}),
}));

vi.mock('@/lib/slack-api', () => ({
  chatPostMessage: vi.fn(async () => ({ ok: true, ts: '1234.5678' })),
  markdownSection: vi.fn((text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } })),
  contextBlock: vi.fn((elements: unknown[]) => ({ type: 'context', elements })),
}));

// Mock verifySlackSignature — configurable per test
const mockVerifySlackSignature = vi.fn();
vi.mock('@/lib/slack-verify', () => ({
  verifySlackSignature: (...args: unknown[]) => mockVerifySlackSignature(...args),
}));

// Mock next/server's after() to execute immediately
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (fn: () => Promise<void>) => {
      fn().catch(() => {});
    },
  };
});

// Import after mocks
import { POST as eventsPost } from '@/app/api/slack/events/route';
import { POST as interactionsPost } from '@/app/api/slack/interactions/route';

// ---------- Helpers ----------

function makeEventsRequest(body: string): NextRequest {
  return new NextRequest(new URL('http://localhost:3002/api/slack/events'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-slack-signature': 'v0=test',
      'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body,
  });
}

function makeInteractionsRequest(body: string): NextRequest {
  return new NextRequest(new URL('http://localhost:3002/api/slack/interactions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-slack-signature': 'v0=test',
      'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body,
  });
}

function mockChain(result: { data?: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const terminal = vi.fn(async () => result);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.lt = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn(async () => result);
  chain.single = terminal;
  chain.maybeSingle = terminal;
  return chain;
}

// ---------- Events route tests ----------

describe('POST /api/slack/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: valid signature
    mockVerifySlackSignature.mockReturnValue({ valid: true });
  });

  it('returns 401 for invalid signature', async () => {
    mockVerifySlackSignature.mockReturnValue({ valid: false, reason: 'Invalid signature' });

    const body = JSON.stringify({ type: 'url_verification', challenge: 'test' });
    const req = makeEventsRequest(body);

    const res = await eventsPost(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid signature');
  });

  it('returns 401 for missing signature headers', async () => {
    mockVerifySlackSignature.mockReturnValue({
      valid: false,
      reason: 'Missing signature or timestamp header',
    });

    const body = JSON.stringify({ type: 'url_verification', challenge: 'test' });
    const req = new NextRequest(new URL('http://localhost:3002/api/slack/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const res = await eventsPost(req);
    expect(res.status).toBe(401);
  });

  it('handles url_verification challenge', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    const req = makeEventsRequest(body);

    const res = await eventsPost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.challenge).toBe('abc123');
  });

  it('returns 400 for invalid JSON', async () => {
    const body = 'not-json{{{';
    const req = makeEventsRequest(body);

    const res = await eventsPost(req);
    expect(res.status).toBe(400);
  });

  it('handles event_callback with message.im and triggers agent reply', async () => {
    const connChain = mockChain({
      data: { workspace_id: 'ws-1', bot_user_id: 'U_BOT' },
    });
    const convChain = mockChain({ data: null });

    let convCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'slack_connections') return connChain;
      if (table === 'slack_conversations') {
        convCallCount++;
        if (convCallCount === 1) return convChain; // select (lookup)
        return mockChain({ data: null }); // insert
      }
      if (table === 'agent_configs') return mockChain({ data: null });
      return mockChain({ data: null });
    });

    const body = JSON.stringify({
      type: 'event_callback',
      team_id: 'T123',
      event_id: 'Ev_msg_im_' + Date.now(),
      event: {
        type: 'message',
        user: 'U_USER',
        text: 'hello bot',
        channel: 'D123',
        ts: '1234567890.123456',
      },
    });
    const req = makeEventsRequest(body);

    const res = await eventsPost(req);
    expect(res.status).toBe(200);

    // Give the after() callback time to execute
    await new Promise((r) => setTimeout(r, 50));

    // Verify slack_connections was queried
    expect(mockFrom).toHaveBeenCalledWith('slack_connections');
  });

  it('ignores bot messages to prevent loops', async () => {
    const connChain = mockChain({
      data: { workspace_id: 'ws-1', bot_user_id: 'U_BOT' },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'slack_connections') return connChain;
      return mockChain({ data: null });
    });

    const body = JSON.stringify({
      type: 'event_callback',
      team_id: 'T123',
      event_id: 'Ev_bot_msg_' + Date.now(),
      event: {
        type: 'message',
        user: 'U_USER',
        text: 'bot message',
        channel: 'D123',
        ts: '1234567890.999999',
        bot_id: 'B_SOME_BOT',
      },
    });
    const req = makeEventsRequest(body);

    const res = await eventsPost(req);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));

    // Should NOT query slack_connections because bot_id check returns early
    // (bot_id check happens before the DB lookup)
    expect(mockFrom).not.toHaveBeenCalledWith('slack_conversations');
  });

  it('returns 200 for unknown event types', async () => {
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: 'T123',
      event_id: 'Ev_unknown_' + Date.now(),
      event: { type: 'some_future_event' },
    });
    const req = makeEventsRequest(body);

    const res = await eventsPost(req);
    expect(res.status).toBe(200);
  });
});

// ---------- Interactions route tests ----------

describe('POST /api/slack/interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifySlackSignature.mockReturnValue({ valid: true });
  });

  it('returns 401 for invalid signature', async () => {
    mockVerifySlackSignature.mockReturnValue({ valid: false, reason: 'Invalid signature' });

    const payloadObj = {
      type: 'block_actions',
      user: { id: 'U123' },
      team: { id: 'T123' },
      actions: [{ action_id: 'celune_status', type: 'button' }],
    };
    const body = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`;
    const req = makeInteractionsRequest(body);

    const res = await interactionsPost(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing payload', async () => {
    const body = 'no_payload_field=true';
    const req = makeInteractionsRequest(body);

    const res = await interactionsPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON in payload', async () => {
    const body = `payload=${encodeURIComponent('not-json{{{')}`;
    const req = makeInteractionsRequest(body);

    const res = await interactionsPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 200 for valid block_actions payload', async () => {
    const connChain = mockChain({
      data: {
        workspace_id: 'ws-1',
        bot_token_encrypted: 'enc',
        bot_token_iv: 'iv',
        installation_type: 'bot',
        slack_channel_id: 'C123',
      },
    });
    const taskChain = mockChain({ data: [] });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'slack_connections') return connChain;
      if (table === 'tasks') return taskChain;
      return mockChain({ data: null });
    });

    const payloadObj = {
      type: 'block_actions',
      user: { id: 'U123', username: 'testuser' },
      team: { id: 'T123' },
      channel: { id: 'C456' },
      actions: [{ action_id: 'celune_status', type: 'button' }],
    };
    const body = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`;
    const req = makeInteractionsRequest(body);

    const res = await interactionsPost(req);
    expect(res.status).toBe(200);
  });
});

// ---------- Signature verification (tested via routes) ----------

describe('verifySlackSignature (via routes)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests with stale timestamps (replay protection)', async () => {
    mockVerifySlackSignature.mockReturnValue({
      valid: false,
      reason: 'Request too old (replay protection)',
    });

    const body = JSON.stringify({ type: 'url_verification', challenge: 'test' });
    const req = makeEventsRequest(body);

    const res = await eventsPost(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('replay');
  });

  it('rejects when SLACK_SIGNING_SECRET is missing', async () => {
    mockVerifySlackSignature.mockReturnValue({
      valid: false,
      reason: 'SLACK_SIGNING_SECRET not configured',
    });

    const body = JSON.stringify({ type: 'url_verification', challenge: 'test' });
    const req = makeEventsRequest(body);

    const res = await eventsPost(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('SLACK_SIGNING_SECRET');
  });

  it('verifySlackSignature is called with correct arguments', async () => {
    mockVerifySlackSignature.mockReturnValue({ valid: true });

    const body = JSON.stringify({ type: 'url_verification', challenge: 'test' });
    const req = makeEventsRequest(body);

    await eventsPost(req);

    expect(mockVerifySlackSignature).toHaveBeenCalledWith('v0=test', expect.any(String), body);
  });
});
