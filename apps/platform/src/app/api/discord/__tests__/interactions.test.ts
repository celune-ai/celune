/**
 * Discord Interactions Route Tests
 *
 * Tests the POST /api/discord/interactions endpoint which handles
 * all slash commands, button clicks, and autocomplete requests from Discord.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/discord-verify', () => ({
  verifyDiscordSignature: vi.fn(),
}));

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/discord-api', () => ({
  createFollowupMessage: vi.fn(),
  taskEmbed: vi.fn(() => ({ title: 'task', color: 0 })),
  projectEmbed: vi.fn(() => ({ title: 'project', color: 0 })),
  memoryEmbed: vi.fn(() => ({ title: 'memory', color: 0 })),
  actionRow: vi.fn((...buttons: unknown[]) => ({ type: 1, components: buttons })),
  linkButton: vi.fn((label: string, url: string) => ({ type: 2, label, url })),
  primaryButton: vi.fn((label: string, id: string) => ({ type: 2, label, custom_id: id })),
  COLORS: { GREEN: 0x5bc586 },
}));

// Chainable Supabase mock
function createChainableMock(resolvedValue: { data: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  const methods = [
    'from',
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'ilike',
    'like',
    'gte',
    'lte',
    'textSearch',
    'order',
    'limit',
    'maybeSingle',
    'single',
  ];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  // Terminal methods resolve
  (chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedValue);
  (chain.single as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedValue);
  // Make the chain itself thenable for awaits without terminal
  (chain.limit as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedValue);
  return chain;
}

let mockSupabase: ReturnType<typeof createChainableMock>;

const { verifyDiscordSignature } = await import('@/lib/discord-verify');
const { createFollowupMessage } = await import('@/lib/discord-api');
const { POST } = await import('../interactions/route');

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  return new NextRequest('http://localhost:3002/api/discord/interactions', {
    method: 'POST',
    body: raw,
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': 'valid-sig',
      'x-signature-timestamp': '1234567890',
    },
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/discord/interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createChainableMock({ data: null });
    (verifyDiscordSignature as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  // ── Signature verification ──────────────────────────────────────────────

  it('returns 401 for invalid signature', async () => {
    (verifyDiscordSignature as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const res = await POST(makeRequest({ type: 1 }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid signature');
  });

  // ── PING / PONG ─────────────────────────────────────────────────────────

  it('responds to PING with PONG (type 1)', async () => {
    const res = await POST(makeRequest({ type: 1 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ type: 1 });
  });

  // ── APPLICATION_COMMAND ─────────────────────────────────────────────────

  it('defers response for APPLICATION_COMMAND (type 2)', async () => {
    const body = {
      type: 2,
      token: 'interaction-token',
      data: {
        name: 'celune',
        options: [
          {
            name: 'task',
            options: [
              {
                name: 'list',
                options: [{ name: 'status', value: 'in_progress' }],
              },
            ],
          },
        ],
      },
      member: { user: { id: 'discord-user-123' } },
    };

    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    // Type 5 = DEFERRED_CHANNEL_MESSAGE
    expect(json.type).toBe(5);
  });

  // ── AUTOCOMPLETE ────────────────────────────────────────────────────────

  it('returns choices array for AUTOCOMPLETE (type 4)', async () => {
    // Mock the discord_connections lookup
    mockSupabase = createChainableMock({
      data: { workspace_id: 'ws-1' },
    });

    const body = {
      type: 4,
      data: {
        name: 'celune',
        options: [
          {
            name: 'task',
            options: [
              {
                name: 'start',
                options: [{ name: 'id', value: 'fix', focused: true }],
              },
            ],
          },
        ],
      },
      member: { user: { id: 'discord-user-123' } },
    };

    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    // Type 8 = AUTOCOMPLETE_RESULT
    expect(json.type).toBe(8);
    expect(json.data).toHaveProperty('choices');
    expect(Array.isArray(json.data.choices)).toBe(true);
  });

  // ── MESSAGE_COMPONENT ──────────────────────────────────────────────────

  it('defers response for MESSAGE_COMPONENT (type 3)', async () => {
    const body = {
      type: 3,
      token: 'interaction-token',
      data: { custom_id: 'task_start_abc123' },
      member: { user: { id: 'discord-user-123' } },
    };

    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    // Type 5 = DEFERRED_CHANNEL_MESSAGE
    expect(json.type).toBe(5);
  });

  // ── Unknown type ────────────────────────────────────────────────────────

  it('returns 400 for unknown interaction type', async () => {
    const res = await POST(makeRequest({ type: 99 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Unknown interaction type');
  });

  // ── Invalid JSON ────────────────────────────────────────────────────────

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost:3002/api/discord/interactions', {
      method: 'POST',
      body: 'not-json{{{',
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': 'valid-sig',
        'x-signature-timestamp': '1234567890',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON');
  });
});
