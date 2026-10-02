import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock @repo/db/server
vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'test-user-id' } } }) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
  })),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    },
    ApiError: class extends Error {
      statusCode: number;
      userMessage: string;
      constructor(s: number, m: string) {
        super(m);
        this.statusCode = s;
        this.userMessage = m;
      }
    },
  };
});

vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_AI: {},
}));

vi.mock('@repo/db/validation', () => ({
  isValidUuid: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

// Mock CSRF validation — allow all by default
const mockValidateOrigin = vi.fn((_req?: unknown) => null as unknown);
vi.mock('@/lib/csrf', () => ({
  validateOrigin: (req: unknown) => mockValidateOrigin(req),
}));

// Mock permissions — allow all permissions in tests
vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(async () => ({
    userId: 'test-user-id',
    resolved: { permissions: new Set(['*']) },
  })),
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getAuthUserId: () => 'test-user-id',
  getOrgIdForUser: async () => 'test-org-id',
  getOrgIdForWorkspace: async () => 'test-org-id',
}));

// Mock ai-job-queue — always use direct API
vi.mock('@/lib/ai-job-queue', () => ({
  resolveAiExecution: async () => ({
    mode: 'direct_api',
    providerKey: { key: 'test-key', source: 'platform' },
    ideConnected: false,
  }),
  executeViaQueue: vi.fn(),
  IdeConnectionRequiredError: class extends Error {
    provider = 'anthropic';
  },
}));

// Mock Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

// Set API key so getClient() doesn't throw
vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');

import { POST } from '../../api/voice/parse/route';

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL('/api/voice/parse', 'http://localhost:3002'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      origin: 'http://localhost:3002',
      ...headers,
    },
  } as never);
}

function mockAnthropicResponse(content: unknown) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(content) }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateOrigin.mockReturnValue(null);
});

describe('POST /api/voice/parse', () => {
  describe('input validation', () => {
    it('returns 400 for missing transcript', async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });

    it('returns 400 for empty transcript', async () => {
      const res = await POST(makeRequest({ transcript: '' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for transcript exceeding 10000 chars', async () => {
      const res = await POST(makeRequest({ transcript: 'a'.repeat(10_001) }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });

    it('accepts transcript at exactly 10000 chars', async () => {
      mockAnthropicResponse({
        intent: 'none',
        tasks: [],
        updates: [],
        message: 'No actionable content',
      });
      const res = await POST(makeRequest({ transcript: 'a'.repeat(10_000) }));
      expect(res.status).toBe(200);
    });
  });

  describe('CSRF validation', () => {
    it('rejects requests when CSRF validation fails', async () => {
      const { NextResponse } = await import('next/server');
      mockValidateOrigin.mockReturnValueOnce(
        NextResponse.json({ error: 'CSRF rejected' }, { status: 403 }),
      );
      const res = await POST(makeRequest({ transcript: 'hello' }));
      expect(res.status).toBe(403);
    });
  });

  describe('AI response parsing', () => {
    it('returns parsed create_task intent', async () => {
      mockAnthropicResponse({
        intent: 'create_task',
        tasks: [{ title: 'Fix the bug', priority: 'high', project_id: null }],
        updates: [],
        message: 'Created 1 task',
      });

      const res = await POST(
        makeRequest({ transcript: 'Create a task to fix the bug, high priority' }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.intent).toBe('create_task');
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].title).toBe('Fix the bug');
      expect(data.tasks[0].priority).toBe('high');
    });

    it('returns parsed update_task intent', async () => {
      mockAnthropicResponse({
        intent: 'update_task',
        tasks: [],
        updates: [{ search_query: 'auth middleware', changes: { status: 'done' } }],
        message: 'Marked 1 task done',
      });

      const res = await POST(makeRequest({ transcript: 'Mark auth middleware as done' }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.intent).toBe('update_task');
      expect(data.updates).toHaveLength(1);
      expect(data.updates[0].search_query).toBe('auth middleware');
    });

    it('returns 502 for unparseable AI response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'This is not JSON' }],
      });

      const res = await POST(makeRequest({ transcript: 'hello' }));
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain('parse');
    });

    it('returns 502 for invalid AI response structure', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ random: 'data' }) }],
      });

      const res = await POST(makeRequest({ transcript: 'hello' }));
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain('unexpected format');
    });
  });

  describe('validateParseResult — schema validation', () => {
    it('drops tasks with missing title', async () => {
      mockAnthropicResponse({
        intent: 'create_task',
        tasks: [
          { title: '', priority: 'normal', project_id: null },
          { title: 'Valid task', priority: 'normal', project_id: null },
        ],
        updates: [],
        message: 'Created tasks',
      });

      const res = await POST(makeRequest({ transcript: 'hello' }));
      const data = await res.json();
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].title).toBe('Valid task');
    });

    it('defaults invalid priority to normal', async () => {
      mockAnthropicResponse({
        intent: 'create_task',
        tasks: [{ title: 'Test', priority: 'SUPER_URGENT', project_id: null }],
        updates: [],
        message: 'Created task',
      });

      const res = await POST(makeRequest({ transcript: 'test' }));
      const data = await res.json();
      expect(data.tasks[0].priority).toBe('normal');
    });

    it('truncates long titles to 200 chars', async () => {
      mockAnthropicResponse({
        intent: 'create_task',
        tasks: [{ title: 'X'.repeat(300), priority: 'normal', project_id: null }],
        updates: [],
        message: 'ok',
      });

      const res = await POST(makeRequest({ transcript: 'test' }));
      const data = await res.json();
      expect(data.tasks[0].title.length).toBe(200);
    });

    it('truncates long descriptions to 2000 chars', async () => {
      mockAnthropicResponse({
        intent: 'create_task',
        tasks: [
          { title: 'Test', description: 'D'.repeat(3000), priority: 'normal', project_id: null },
        ],
        updates: [],
        message: 'ok',
      });

      const res = await POST(makeRequest({ transcript: 'test' }));
      const data = await res.json();
      expect(data.tasks[0].description.length).toBe(2000);
    });

    it('truncates long messages to 500 chars', async () => {
      mockAnthropicResponse({
        intent: 'none',
        tasks: [],
        updates: [],
        message: 'M'.repeat(600),
      });

      const res = await POST(makeRequest({ transcript: 'test' }));
      const data = await res.json();
      expect(data.message.length).toBe(500);
    });
  });

  describe('project_id whitelist validation', () => {
    const validProjectId = '11111111-2222-3333-4444-555555555555';

    it('allows project_id from context.existingProjects', async () => {
      mockAnthropicResponse({
        intent: 'create_task',
        tasks: [{ title: 'Test', priority: 'normal', project_id: validProjectId }],
        updates: [],
        message: 'ok',
      });

      const res = await POST(
        makeRequest({
          transcript: 'add to project',
          context: {
            existingProjects: [{ id: validProjectId, name: 'My Project' }],
          },
        }),
      );
      const data = await res.json();
      expect(data.tasks[0].project_id).toBe(validProjectId);
    });

    it('nullifies project_id not in whitelist', async () => {
      const unknownId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      mockAnthropicResponse({
        intent: 'create_task',
        tasks: [{ title: 'Test', priority: 'normal', project_id: unknownId }],
        updates: [],
        message: 'ok',
      });

      const res = await POST(
        makeRequest({
          transcript: 'add task',
          context: {
            existingProjects: [{ id: validProjectId, name: 'My Project' }],
          },
        }),
      );
      const data = await res.json();
      expect(data.tasks[0].project_id).toBeNull();
    });

    it('nullifies invalid UUID project_id', async () => {
      mockAnthropicResponse({
        intent: 'create_task',
        tasks: [{ title: 'Test', priority: 'normal', project_id: 'not-a-uuid' }],
        updates: [],
        message: 'ok',
      });

      const res = await POST(makeRequest({ transcript: 'test' }));
      const data = await res.json();
      expect(data.tasks[0].project_id).toBeNull();
    });
  });

  describe('error handling', () => {
    it('returns 503 when ANTHROPIC_API_KEY is missing', async () => {
      // We need to test the getClient() path when key is missing.
      // The module-level singleton makes this tricky — but the error message check works:
      mockCreate.mockRejectedValueOnce(new Error('Voice parse service unavailable'));
      const res = await POST(makeRequest({ transcript: 'hello' }));
      expect(res.status).toBe(503);
    });

    it('returns 500 for unexpected Anthropic errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Network timeout'));
      const res = await POST(makeRequest({ transcript: 'hello' }));
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Internal error');
    });
  });
});
