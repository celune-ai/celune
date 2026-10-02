import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock @repo/db/server
vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'test-user-id' } } }) },
    from: vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { voice_settings: {} },
            error: null,
          })),
        })),
      })),
    })),
  })),
}));

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

// Mock permissions — allow all permissions in tests
vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(async () => ({
    userId: 'test-user-id',
    resolved: { permissions: new Set(['*']) },
  })),
}));

// Mock UUID validation — accept all in tests
vi.mock('@repo/db/validation', () => ({
  isValidUuid: vi.fn(() => true),
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

// Mock @repo/db/queries
vi.mock('@repo/db/queries', () => ({
  createActivity: vi.fn(),
}));

// Mock elevenlabs service
const mockCloneVoice = vi.fn();
const mockInvalidateVoiceCache = vi.fn();
vi.mock('@/lib/elevenlabs', () => ({
  cloneVoice: (...args: unknown[]) => mockCloneVoice(...args),
  invalidateVoiceCache: () => mockInvalidateVoiceCache(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(() => null),
  getOrgIdForUser: vi.fn(async () => null),
}));

vi.mock('@/lib/resolve-provider-key', () => ({
  resolveProviderKey: vi.fn(async () => ({ key: 'test-elevenlabs-key', source: 'platform' })),
}));

vi.mock('@/lib/agent-loader', () => ({
  loadAgentConfig: vi.fn(async () => null),
}));

import { POST } from '../agents/[id]/voice/clone/route';

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Create a mock NextRequest that returns a controlled FormData from .formData() */
function makeMockRequest(
  agentId: string,
  formEntries: Record<string, string | Blob | Blob[]>,
): NextRequest {
  const req = new NextRequest(
    new URL(`/api/agents/${agentId}/voice/clone`, 'http://localhost:3002'),
    { method: 'POST' },
  );

  // Override formData() to return a controlled FormData
  const fd = new globalThis.FormData();
  for (const [key, value] of Object.entries(formEntries)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v);
    } else {
      fd.append(key, value as string);
    }
  }
  (req as { formData: () => Promise<FormData> }).formData = async () => fd;

  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/agents/[id]/voice/clone', () => {
  it('clones a voice with valid input', async () => {
    mockCloneVoice.mockResolvedValueOnce({
      voice_id: 'cloned-v1',
      name: 'RICK Clone',
    });

    const audioBlob = new Blob(['audio-data'], { type: 'audio/webm' });
    const req = makeMockRequest('rick', {
      name: 'RICK Clone',
      description: 'Test clone',
      files: [audioBlob],
    });

    const res = await POST(req, makeParams('rick'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.voice_id).toBe('cloned-v1');
    expect(data.name).toBe('RICK Clone');
    expect(mockCloneVoice).toHaveBeenCalledWith(
      'RICK Clone',
      'Test clone',
      expect.any(Array),
      undefined,
    );
  });

  it('returns 400 for missing name', async () => {
    const audioBlob = new Blob(['audio-data'], { type: 'audio/webm' });
    const req = makeMockRequest('rick', { files: [audioBlob] });

    const res = await POST(req, makeParams('rick'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('name');
  });

  it('returns 400 for missing files', async () => {
    const req = makeMockRequest('rick', { name: 'Test Voice' });

    const res = await POST(req, makeParams('rick'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('file');
  });

  it('returns 404 for unknown agent', async () => {
    const audioBlob = new Blob(['audio-data'], { type: 'audio/webm' });
    const req = makeMockRequest('unknown', {
      name: 'Test',
      files: [audioBlob],
    });

    const res = await POST(req, makeParams('unknown'));
    expect(res.status).toBe(404);
  });

  it('returns 500 when ElevenLabs clone fails', async () => {
    mockCloneVoice.mockRejectedValueOnce(new Error('ElevenLabs API error'));

    const audioBlob = new Blob(['audio-data'], { type: 'audio/webm' });
    const req = makeMockRequest('rick', {
      name: 'RICK Clone',
      files: [audioBlob],
    });

    const res = await POST(req, makeParams('rick'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('ElevenLabs');
  });
});
