/**
 * Memory API Route Tests
 *
 * Tests auth rejection, ownership isolation, input validation,
 * and CRUD operations for /api/memory/entries routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock CSRF validation — allow all origins in tests
vi.mock('@/lib/csrf', () => ({
  validateOrigin: vi.fn(() => null),
}));

// Mock rate limiter — no rate limiting in tests
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: { requests: 60, windowMs: 60000 },
  RATE_AI: { requests: 20, windowMs: 60000 },
  RATE_AUTH: { requests: 5, windowMs: 60000 },
}));

// Mock UUID validation — accept all in tests
vi.mock('@repo/db/validation', () => ({
  isValidUuid: vi.fn(() => true),
}));

// Mock Supabase server client
const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
};

vi.mock('@repo/db/server', () => ({
  createClient: () => Promise.resolve(mockSupabase),
}));

vi.mock('@repo/db/queries', () => ({
  getAgentMemoryEntries: vi.fn().mockResolvedValue({ data: [], count: 0 }),
}));

vi.mock('@/lib/api-error', () => ({
  safeErrorResponse: (error: Error) => {
    const { NextResponse } = require('next/server');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  },
}));

vi.mock('@/lib/plan-enforcement', () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/require-workspace', () => ({
  extractWorkspaceScope: () => ({ workspace_id: 'ws-1' }),
  requireWorkspaceMembership: vi.fn(async () => null),
}));

function createRequest(
  url: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };
  if (options.body) {
    (init as Record<string, unknown>).body = JSON.stringify(options.body);
  }
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

const AUTHENTICATED_USER = { id: 'user-123', email: 'test@example.com' };

describe('Memory Entries API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.from.mockReturnThis();
    mockSupabase.select.mockReturnThis();
    mockSupabase.eq.mockReturnThis();
    mockSupabase.insert.mockReturnThis();
    mockSupabase.update.mockReturnThis();
    mockSupabase.delete.mockReturnThis();
  });

  describe('GET /api/memory/entries', () => {
    it('returns 401 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const { GET } = await import('@/app/api/memory/entries/route');
      const res = await GET(createRequest('http://localhost:3002/api/memory/entries'));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('returns entries for authenticated user', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: AUTHENTICATED_USER },
      });

      const { getAgentMemoryEntries } = await import('@repo/db/queries');
      (getAgentMemoryEntries as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: [{ id: 'mem-1', key: 'test', content: 'hello' }],
        count: 1,
      });

      const { GET } = await import('@/app/api/memory/entries/route');
      const res = await GET(createRequest('http://localhost:3002/api/memory/entries'));

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/memory/entries', () => {
    it('returns 401 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const { POST } = await import('@/app/api/memory/entries/route');
      const res = await POST(
        createRequest('http://localhost:3002/api/memory/entries', {
          method: 'POST',
          body: { key: 'test', content: 'hello' },
        }),
      );

      expect(res.status).toBe(401);
    });

    it('returns 400 when key or content missing', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: AUTHENTICATED_USER },
      });

      const { POST } = await import('@/app/api/memory/entries/route');
      const res = await POST(
        createRequest('http://localhost:3002/api/memory/entries', {
          method: 'POST',
          body: { content: 'hello' }, // missing key
        }),
      );

      expect(res.status).toBe(400);
    });

    it('returns 400 when content exceeds max length', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: AUTHENTICATED_USER },
      });

      const { POST } = await import('@/app/api/memory/entries/route');
      const res = await POST(
        createRequest('http://localhost:3002/api/memory/entries', {
          method: 'POST',
          body: { key: 'test', content: 'x'.repeat(10001) },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
    });

    it('returns 400 when tags exceed max length', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: AUTHENTICATED_USER },
      });

      const { POST } = await import('@/app/api/memory/entries/route');
      const res = await POST(
        createRequest('http://localhost:3002/api/memory/entries', {
          method: 'POST',
          body: { key: 'test', content: 'hello', tags: 'x'.repeat(501) },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
    });

    it('creates memory entry for authenticated user', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: AUTHENTICATED_USER },
      });
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'mem-new', key: 'test' },
        error: null,
      });

      const { POST } = await import('@/app/api/memory/entries/route');
      const res = await POST(
        createRequest('http://localhost:3002/api/memory/entries', {
          method: 'POST',
          body: { key: 'test', content: 'hello world' },
        }),
      );

      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/memory/entries/[id]', () => {
    it('returns 401 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const { GET } = await import('@/app/api/memory/entries/[id]/route');
      const res = await GET(createRequest('http://localhost:3002/api/memory/entries/mem-1'), {
        params: Promise.resolve({ id: 'mem-1' }),
      });

      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent entry', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: AUTHENTICATED_USER },
      });
      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const { GET } = await import('@/app/api/memory/entries/[id]/route');
      const res = await GET(createRequest('http://localhost:3002/api/memory/entries/nonexistent'), {
        params: Promise.resolve({ id: 'nonexistent' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/memory/entries/[id]', () => {
    it('returns 403 when trying to delete system memory', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: AUTHENTICATED_USER },
      });
      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: { id: 'mem-sys', source: 'system', user_id: AUTHENTICATED_USER.id },
        error: null,
      });

      const { DELETE } = await import('@/app/api/memory/entries/[id]/route');
      const res = await DELETE(
        createRequest('http://localhost:3002/api/memory/entries/mem-sys', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'mem-sys' }) },
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('System');
    });
  });
});
