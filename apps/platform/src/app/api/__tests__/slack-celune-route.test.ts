import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import * as crypto from 'node:crypto';

const SIGNING_SECRET = 'test-signing-secret-celune';

// Stub env BEFORE module imports
vi.stubEnv('SLACK_SIGNING_SECRET', SIGNING_SECRET);
vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.celune.ai');

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'slack_connections') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      workspace_id: 'ws-123',
                      installation_type: 'bot',
                      celune_user_id: 'user-abc',
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === 'tasks') {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [
                        { title: 'Fix bug', status: 'inbox', assignee: 'rick', priority: 'high' },
                        {
                          title: 'Add feature',
                          status: 'in_progress',
                          assignee: 'sage',
                          priority: 'normal',
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
          insert: (payload: unknown) => {
            mockInsert(payload);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: 'task-new-123', title: (payload as { title: string }).title },
                    error: null,
                  }),
              }),
            };
          },
        };
      }
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [{ name: 'Slack App', status: 'active', project_type: 'feature' }],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: mockSelect };
    },
  })),
}));

const mockCreateActivity = vi.fn().mockResolvedValue({ id: 'log-1' });
vi.mock('@repo/db/queries', () => ({
  createActivity: (...args: unknown[]) => mockCreateActivity(...args),
}));

// Import AFTER mocks
let POST: (req: NextRequest) => Promise<Response>;
beforeAll(async () => {
  const mod = await import('../../api/slack/celune/route');
  POST = mod.POST;
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: string, overrides?: { secret?: string; timestamp?: number }) {
  const timestamp = overrides?.timestamp ?? Math.floor(Date.now() / 1000);
  const secret = overrides?.secret ?? SIGNING_SECRET;
  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature = 'v0=' + crypto.createHmac('sha256', secret).update(sigBasestring).digest('hex');

  return new NextRequest(new URL('http://localhost:3002/api/slack/celune'), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-signature': signature,
      'x-slack-request-timestamp': String(timestamp),
    },
    body,
  } as never);
}

function makeBody(overrides: Record<string, string> = {}) {
  const defaults = {
    team_id: 'T123TEAM',
    user_id: 'U456USER',
    text: '',
    channel_id: 'C789CHAN',
    response_url: 'https://hooks.slack.com/commands/test',
  };
  return new URLSearchParams({ ...defaults, ...overrides }).toString();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/slack/celune', () => {
  it('rejects requests with invalid signature', async () => {
    const body = makeBody({ text: 'status' });
    const req = makeRequest(body, { secret: 'wrong-secret' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns help for empty command', async () => {
    const body = makeBody({ text: '' });
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toBe('/celune commands');
    expect(json.blocks).toBeDefined();
  });

  it('returns task status counts', async () => {
    const body = makeBody({ text: 'status' });
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toContain('open tasks');
  });

  it('handles task list', async () => {
    const body = makeBody({ text: 'task list' });
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toContain('open tasks');
  });

  it('creates a task via task create', async () => {
    const body = makeBody({ text: 'task create Fix the login page' });
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toContain('Task created');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Fix the login page',
        status: 'inbox',
        workspace_id: 'ws-123',
        source: 'slack',
      }),
    );
  });

  it('returns error for task create without title', async () => {
    const body = makeBody({ text: 'task create' });
    const req = makeRequest(body);
    const res = await POST(req);
    const json = await res.json();
    expect(json.text).toContain('Usage');
  });

  it('handles project list', async () => {
    const body = makeBody({ text: 'project list' });
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toContain('active projects');
  });

  it('returns unknown command for invalid input', async () => {
    const body = makeBody({ text: 'foobar' });
    const req = makeRequest(body);
    const res = await POST(req);
    const json = await res.json();
    expect(json.text).toContain('Unknown command');
  });

  it('returns unknown subcommand for invalid task subcommand', async () => {
    const body = makeBody({ text: 'task foobar' });
    const req = makeRequest(body);
    const res = await POST(req);
    const json = await res.json();
    expect(json.text).toContain('Unknown task subcommand');
  });

  it('logs command execution', async () => {
    const body = makeBody({ text: 'help' });
    const req = makeRequest(body);
    await POST(req);
    expect(mockCreateActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event_type: 'slack.command_executed',
        source: 'slack-celune',
      }),
    );
  });
});
