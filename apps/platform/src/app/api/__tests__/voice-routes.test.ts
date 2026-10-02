import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock @repo/db/server
vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'test-user-id' } } }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              voice_settings: {
                provider: 'elevenlabs',
                voice_id: 'v1',
                voice_name: 'Adam',
                params: { stability: 0.5, similarity_boost: 0.75, style: 0 },
              },
            },
            error: null,
          })),
        })),
      })),
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

vi.mock('@/lib/parse-body', async () => {
  const { NextResponse } = await import('next/server');
  return {
    parseBody: async (request: Request, schema: { parse: (v: unknown) => unknown }) => {
      try {
        const body = await request.json();
        return schema.parse(body);
      } catch {
        return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
      }
    },
    isErrorResponse: (v: unknown) => v instanceof NextResponse,
  };
});

// Mock @repo/db/queries
vi.mock('@repo/db/queries', () => ({
  createActivity: vi.fn(),
}));

// Mock elevenlabs service (used by voice-providers internally)
const mockListVoices = vi.fn();
const mockGenerateSpeech = vi.fn();
vi.mock('@/lib/elevenlabs', () => ({
  listVoices: (...args: unknown[]) => mockListVoices(...args),
  generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
}));

// Mock voice provider abstraction (used by preview route)
vi.mock('@/lib/voice-providers/resolve', () => ({
  resolveVoiceProvider: vi.fn(async () => ({
    provider: {
      name: 'elevenlabs',
      displayName: 'ElevenLabs',
      generateSpeech: async (...args: unknown[]) => ({
        audio: mockGenerateSpeech(...args),
      }),
    },
    apiKey: 'test-elevenlabs-key',
    keySource: 'platform',
  })),
}));

// Mock tts-preprocess (used by preview route)
vi.mock('@/lib/tts-preprocess', () => ({
  preprocessForTTS: (text: string) => text,
  prependV3AudioTags: (text: string) => text,
}));

vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(() => 'test-user-id'),
  getOrgIdForUser: vi.fn(async () => null),
}));

vi.mock('@/lib/resolve-provider-key', () => ({
  resolveProviderKey: vi.fn(async () => ({ key: 'test-elevenlabs-key', source: 'platform' })),
}));

vi.mock('@/lib/agent-loader', () => ({
  loadAgentConfig: vi.fn(async () => null),
}));

import { GET, PUT } from '../agents/[id]/voice/route';
import { POST } from '../agents/[id]/voice/preview/route';

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/agents/[id]/voice', () => {
  it('returns voices and current settings for valid agent', async () => {
    mockListVoices.mockResolvedValueOnce([
      { voice_id: 'v1', name: 'Adam', labels: {}, preview_url: '' },
    ]);

    const res = await GET(makeRequest('/api/agents/rick/voice'), makeParams('rick'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.voices).toHaveLength(1);
    expect(data.current).toBeTruthy();
  });

  it('returns 404 for unknown agent', async () => {
    const res = await GET(makeRequest('/api/agents/unknown/voice'), makeParams('unknown'));
    expect(res.status).toBe(404);
  });

  it('returns 404 for human agent', async () => {
    const res = await GET(makeRequest('/api/agents/eric/voice'), makeParams('eric'));
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/agents/[id]/voice', () => {
  it('saves voice settings for valid agent', async () => {
    const body = {
      provider: 'elevenlabs',
      voice_id: 'v1',
      voice_name: 'Adam',
      params: { stability: 0.5, similarity_boost: 0.75, style: 0 },
    };
    const req = makeRequest('/api/agents/rick/voice', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await PUT(req, makeParams('rick'));
    expect(res.status).toBe(200);
  });

  it('returns 400 for missing required fields', async () => {
    const req = makeRequest('/api/agents/rick/voice', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'elevenlabs' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await PUT(req, makeParams('rick'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for out-of-range params', async () => {
    const body = {
      provider: 'elevenlabs',
      voice_id: 'v1',
      voice_name: 'Adam',
      params: { stability: 5, similarity_boost: -1, style: 0.5 },
    };
    const req = makeRequest('/api/agents/rick/voice', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await PUT(req, makeParams('rick'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/agents/[id]/voice/preview', () => {
  it('returns audio for valid request', async () => {
    mockGenerateSpeech.mockResolvedValueOnce(new ArrayBuffer(100));

    const req = makeRequest('/api/agents/rick/voice/preview', {
      method: 'POST',
      body: JSON.stringify({ voice_id: 'v1', text: 'Hello' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, makeParams('rick'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('returns 400 for missing voice_id', async () => {
    const req = makeRequest('/api/agents/rick/voice/preview', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hello' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, makeParams('rick'));
    expect(res.status).toBe(400);
  });

  it('uses default text when none provided', async () => {
    mockGenerateSpeech.mockResolvedValueOnce(new ArrayBuffer(10));

    const req = makeRequest('/api/agents/rick/voice/preview', {
      method: 'POST',
      body: JSON.stringify({ voice_id: 'v1' }),
      headers: { 'Content-Type': 'application/json' },
    });

    await POST(req, makeParams('rick'));
    expect(mockGenerateSpeech).toHaveBeenCalledWith(
      'v1',
      expect.stringContaining('RICK'),
      expect.any(Object),
      'test-elevenlabs-key',
    );
  });

  it('returns 400 for text exceeding 5000 chars', async () => {
    const longText = 'a'.repeat(5001);

    const req = makeRequest('/api/agents/rick/voice/preview', {
      method: 'POST',
      body: JSON.stringify({ voice_id: 'v1', text: longText }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, makeParams('rick'));
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown agent', async () => {
    const req = makeRequest('/api/agents/unknown/voice/preview', {
      method: 'POST',
      body: JSON.stringify({ voice_id: 'v1', text: 'Test' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, makeParams('unknown'));
    expect(res.status).toBe(404);
  });
});
