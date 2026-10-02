import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import * as crypto from 'node:crypto';

const SIGNING_SECRET = 'test-signing-secret-12345';
const ALLOWED_USER = 'U12345';

// Stub env BEFORE any module imports read them
vi.stubEnv('SLACK_SIGNING_SECRET', SIGNING_SECRET);
vi.stubEnv('SLACK_ALLOWED_USER_IDS', ALLOWED_USER);

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        neq: () =>
          Promise.resolve({
            data: [{ status: 'inbox' }, { status: 'in_progress' }],
            error: null,
          }),
      }),
    }),
  })),
}));

const mockCreateActivity = vi.fn().mockResolvedValue({ id: 'test-id' });
vi.mock('@repo/db/queries', () => ({
  createActivity: (...args: unknown[]) => mockCreateActivity(...args),
}));

// Import AFTER mocks and env stubs
let POST: (req: NextRequest) => Promise<Response>;
beforeAll(async () => {
  const mod = await import('../../api/slack/commands/route');
  POST = mod.POST;
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeSlackRequest(body: string, overrides?: { secret?: string; timestamp?: number }) {
  const timestamp = overrides?.timestamp ?? Math.floor(Date.now() / 1000);
  const secret = overrides?.secret ?? SIGNING_SECRET;
  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature = 'v0=' + crypto.createHmac('sha256', secret).update(sigBasestring).digest('hex');

  return new NextRequest(new URL('http://localhost:3002/api/slack/commands'), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-signature': signature,
      'x-slack-request-timestamp': String(timestamp),
    },
    body,
  } as never);
}

describe('POST /api/slack/commands', () => {
  it('rejects requests with invalid signature', async () => {
    const body = `user_id=${ALLOWED_USER}&text=status`;
    const req = makeSlackRequest(body, { secret: 'wrong-secret' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects requests with expired timestamp', async () => {
    const body = `user_id=${ALLOWED_USER}&text=status`;
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
    const req = makeSlackRequest(body, { timestamp: oldTimestamp });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('replay');
  });

  it('rejects unauthorized users with ephemeral message', async () => {
    const body = 'user_id=UUNKNOWN&text=status';
    const req = makeSlackRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toContain('not authorized');
  });

  it('returns help for empty command', async () => {
    const body = `user_id=${ALLOWED_USER}&text=`;
    const req = makeSlackRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toContain('/remote');
  });

  it('returns task status counts', async () => {
    const body = `user_id=${ALLOWED_USER}&text=status`;
    const req = makeSlackRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toContain('open tasks');
  });

  it('returns unknown command for invalid subcommand', async () => {
    const body = `user_id=${ALLOWED_USER}&text=foobar`;
    const req = makeSlackRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toContain('Unknown command');
  });

  it('logs successful commands to activity_log', async () => {
    const body = `user_id=${ALLOWED_USER}&text=help`;
    const req = makeSlackRequest(body);
    await POST(req);
    expect(mockCreateActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event_type: 'remote.command_executed',
        source: 'slack-remote',
      }),
    );
  });

  it('logs denied commands to activity_log', async () => {
    const body = 'user_id=UUNKNOWN&text=status';
    const req = makeSlackRequest(body);
    await POST(req);
    expect(mockCreateActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event_type: 'remote.command_denied',
        severity: 'warning',
      }),
    );
  });

  it('lists health command in help output', async () => {
    const body = `user_id=${ALLOWED_USER}&text=help`;
    const req = makeSlackRequest(body);
    const res = await POST(req);
    const json = await res.json();
    const allText = JSON.stringify(json.blocks);
    expect(allText).toContain('health');
  });

  // Keep this test LAST — it exhausts the rate limit for the allowed user
  it('rate limits after too many requests', async () => {
    let hitLimit = false;
    for (let i = 0; i < 15; i++) {
      const body = `user_id=${ALLOWED_USER}&text=help`;
      const req = makeSlackRequest(body);
      const res = await POST(req);
      if (res.status === 429) {
        const json = await res.json();
        expect(json.text).toContain('Too many commands');
        hitLimit = true;
        break;
      }
    }
    expect(hitLimit).toBe(true);
  });
});
