/**
 * Discord OAuth Route Tests
 *
 * Tests the GET /api/discord/install and GET /api/discord/oauth/callback endpoints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/oauth-state', () => ({
  generateDiscordOAuthState: vi.fn(() => 'signed-state-token'),
  parseDiscordOAuthState: vi.fn(),
}));

vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => mockServiceSupabase),
}));

// Mock global fetch for Discord API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Chainable Supabase mock
function createChainableMock(resolvedValue: { data: unknown; error?: unknown }) {
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
    'order',
    'limit',
    'maybeSingle',
    'single',
  ];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  (chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedValue);
  (chain.single as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedValue);
  return chain;
}

let mockServiceSupabase: ReturnType<typeof createChainableMock>;

const { parseDiscordOAuthState } = await import('@/lib/oauth-state');
const { createClient } = await import('@repo/db/server');

// ── Tests: OAuth Callback ──────────────────────────────────────────────────

describe('GET /api/discord/oauth/callback', () => {
  let callbackGET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServiceSupabase = createChainableMock({ data: null });
    const mod = await import('../../discord/oauth/callback/route');
    callbackGET = mod.GET;
  });

  it('redirects with error for missing state', async () => {
    const req = new NextRequest('http://localhost:3002/api/discord/oauth/callback?code=abc');

    const res = await callbackGET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('discord=error');
    expect(location).toContain('reason=missing_state');
  });

  it('redirects with error for invalid/expired state', async () => {
    (parseDiscordOAuthState as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const req = new NextRequest(
      'http://localhost:3002/api/discord/oauth/callback?code=abc&state=bad-state',
    );

    const res = await callbackGET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('discord=error');
    expect(location).toContain('reason=invalid_or_expired_state');
  });

  it('redirects with error for missing code', async () => {
    (parseDiscordOAuthState as ReturnType<typeof vi.fn>).mockReturnValue({
      workspaceId: 'ws-1',
      userId: 'user-1',
    });

    const req = new NextRequest(
      'http://localhost:3002/api/discord/oauth/callback?state=valid-state',
    );

    const res = await callbackGET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('discord=error');
    expect(location).toContain('reason=missing_code');
  });

  it('redirects with error when token exchange fails', async () => {
    (parseDiscordOAuthState as ReturnType<typeof vi.fn>).mockReturnValue({
      workspaceId: 'ws-1',
      userId: 'user-1',
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    const req = new NextRequest(
      'http://localhost:3002/api/discord/oauth/callback?code=abc&state=valid-state',
    );

    const res = await callbackGET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('discord=error');
    expect(location).toContain('reason=token_exchange_failed');
  });

  it('redirects to settings on successful connection', async () => {
    (parseDiscordOAuthState as ReturnType<typeof vi.fn>).mockReturnValue({
      workspaceId: 'ws-1',
      userId: 'user-1',
    });

    // Token exchange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'discord-token',
        token_type: 'Bearer',
      }),
    });

    // User fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'discord-uid',
        username: 'testuser',
        global_name: 'Test User',
      }),
    });

    // Workspace slug lookup
    mockServiceSupabase = createChainableMock({
      data: { slug: 'test-ws' },
    });

    const req = new NextRequest(
      'http://localhost:3002/api/discord/oauth/callback?code=abc&guild_id=g1&state=valid-state',
    );

    const res = await callbackGET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('discord=connected');
  });
});

// ── Tests: Install Route ────────────────────────────────────────────────────

describe('GET /api/discord/install', () => {
  let installGET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServiceSupabase = createChainableMock({ data: null });
    const mod = await import('../../discord/install/route');
    installGET = mod.GET;
  });

  it('returns 400 when workspace_id is missing', async () => {
    const req = new NextRequest('http://localhost:3002/api/discord/install');
    const res = await installGET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('workspace_id is required');
  });

  it('returns 401 when user is not authenticated', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const req = new NextRequest('http://localhost:3002/api/discord/install?workspace_id=ws-1');

    const res = await installGET(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 403 when user is not a workspace member', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
    });

    mockServiceSupabase = createChainableMock({ data: null });

    const req = new NextRequest('http://localhost:3002/api/discord/install?workspace_id=ws-1');

    const res = await installGET(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });
});
