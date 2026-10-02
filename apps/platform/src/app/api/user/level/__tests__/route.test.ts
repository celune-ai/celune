import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------- Configurable Supabase mock ----------

/** Per-table mock data. Each table can define behaviour for chained query methods. */
let mockUser: { id: string } | null = { id: 'test-user-id' };
let mockLevelMemory: { content: string } | null = null;
let mockApiKeys: { id: string; last_used_at: string | null }[] = [];
let mockProjects: { id: string }[] = [];

const mockInsert = vi.fn(async () => ({ data: null, error: null }));
const mockUpdate = vi.fn(() => ({
  eq: vi.fn(() => ({
    eq: vi.fn(async () => ({ data: null, error: null })),
  })),
}));

vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockUser } }),
    },
    from: vi.fn((table: string) => {
      if (table === 'agent_memory') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: mockLevelMemory,
                  error: null,
                })),
              })),
            })),
          })),
          insert: mockInsert,
          update: mockUpdate,
        };
      }
      if (table === 'api_keys') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              not: vi.fn(() => ({
                limit: vi.fn(async () => ({
                  data: mockApiKeys,
                  error: null,
                })),
              })),
            })),
          })),
        };
      }
      if (table === 'projects') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn(async () => ({
                  data: mockProjects,
                  error: null,
                })),
              })),
            })),
          })),
        };
      }
      // Fallback
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: null, error: null })),
      };
    }),
  })),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    },
  };
});

import { GET } from '../route';

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { id: 'test-user-id' };
  mockLevelMemory = null;
  mockApiKeys = [];
  mockProjects = [];
});

describe('GET /api/user/level', () => {
  it('returns 401 when no user is authenticated', async () => {
    mockUser = null;

    const res = await GET(makeRequest('http://localhost:3002/api/user/level'));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns level 1 for a new user with no API key usage', async () => {
    const res = await GET(makeRequest('http://localhost:3002/api/user/level'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.level).toBe(1);
    expect(body.max_level).toBe(3);
    expect(body.checks).toHaveLength(3);
    expect(body.checks[0]).toEqual({ level: 1, check: 'signup', completed: true });
    expect(body.checks[1]).toEqual({ level: 2, check: 'mcp_connected', completed: false });
    expect(body.checks[2]).toEqual({ level: 3, check: 'project_completed', completed: false });
  });

  it('returns level 2 when an API key has last_used_at set', async () => {
    mockApiKeys = [{ id: 'key-1', last_used_at: '2026-03-01T00:00:00Z' }];

    const res = await GET(makeRequest('http://localhost:3002/api/user/level'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.level).toBe(2);
    expect(body.checks[1]).toEqual({ level: 2, check: 'mcp_connected', completed: true });
    expect(body.checks[2]).toEqual({ level: 3, check: 'project_completed', completed: false });
  });

  it('returns level 3 when a project has project_status completed', async () => {
    mockApiKeys = [{ id: 'key-1', last_used_at: '2026-03-01T00:00:00Z' }];
    mockProjects = [{ id: 'proj-1' }];

    const res = await GET(makeRequest('http://localhost:3002/api/user/level'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.level).toBe(3);
    expect(body.checks.every((c: { completed: boolean }) => c.completed)).toBe(true);
  });

  it('jumps straight to level 3 if project completed but no prior level stored', async () => {
    // User somehow completed a project without having API key usage recorded —
    // the route checks level < 3 independently, so projects check still runs
    mockApiKeys = [];
    mockProjects = [{ id: 'proj-1' }];

    const res = await GET(makeRequest('http://localhost:3002/api/user/level'));
    const body = await res.json();

    expect(res.status).toBe(200);
    // Level stays 1 because api_keys check fails (currentLevel remains < 2),
    // but projects check runs because currentLevel < 3
    expect(body.level).toBe(3);
  });

  it('persists level to agent_memory via insert when no prior record', async () => {
    const res = await GET(makeRequest('http://localhost:3002/api/user/level'));
    expect(res.status).toBe(200);

    // Should have called insert to persist level:1
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'user-level:test-user-id',
        content: 'level:1',
        category: 'fact',
        memory_type: 'fact',
        source: 'leveling',
        user_id: 'test-user-id',
      }),
    );
  });

  it('updates agent_memory when level increases beyond stored value', async () => {
    mockLevelMemory = { content: 'level:1' };
    mockApiKeys = [{ id: 'key-1', last_used_at: '2026-03-01T00:00:00Z' }];

    const res = await GET(makeRequest('http://localhost:3002/api/user/level'));
    expect(res.status).toBe(200);

    // Should have called update (not insert) to bump level from 1 to 2
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
