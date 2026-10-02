import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      insert: vi.fn(async () => ({ error: null })),
      update: vi.fn().mockReturnThis(),
    })),
  })),
}));

vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_AI: {},
}));

// Mock CSRF validation — test-controllable version
const mockValidateOrigin = vi.fn((_req: unknown) => null as null);
vi.mock('@/lib/csrf', () => ({
  validateOrigin: (req: unknown) => mockValidateOrigin(req),
}));

// Mock permissions — allow all permissions in tests
vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(async () => ({
    userId: 'test-user',
    resolved: { permissions: new Set(['*']) },
  })),
}));

vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(() => 'test-user'),
  getOrgIdForUser: vi.fn(async () => null),
}));

vi.mock('@/lib/resolve-provider-key', () => ({
  resolveProviderKey: vi.fn(async () => ({ key: 'test-openai-key', source: 'platform' })),
  ProviderKeyRequiredError: class ProviderKeyRequiredError extends Error {
    public readonly trialExhausted: boolean;
    public readonly provider: string;
    constructor(provider: string, trialExhausted: boolean) {
      super(`No ${provider} API key configured.`);
      this.name = 'ProviderKeyRequiredError';
      this.provider = provider;
      this.trialExhausted = trialExhausted;
    }
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');

import { POST } from '../../api/voice/transcribe/route';

function makeAudioBlob(content = 'fake audio data', type = 'audio/webm'): Blob {
  return new Blob([content], { type });
}

/**
 * Build a NextRequest with a mocked formData() method.
 *
 * NextRequest.formData() fails to parse multipart bodies in the Vitest/Node
 * environment because the test environment doesn't set the Content-Type
 * boundary correctly when passing FormData as the request body.
 * Mocking formData() directly tests the route logic without HTTP parsing.
 */
function makeRequest(audioBlob?: Blob | null): NextRequest {
  const req = new NextRequest(new URL('/api/voice/transcribe', 'http://localhost:3002'), {
    method: 'POST',
    headers: { origin: 'http://localhost:3002' },
  } as never);

  const formData = new FormData();
  if (audioBlob !== null) {
    const blob = audioBlob ?? makeAudioBlob();
    formData.append('audio', blob, 'recording.webm');
  }

  Object.defineProperty(req, 'formData', { value: vi.fn().mockResolvedValue(formData) });

  return req;
}

function mockWhisperSuccess(transcript: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ text: transcript }),
    text: async () => JSON.stringify({ text: transcript }),
  });
}

function mockWhisperError(status = 500) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => 'Internal Server Error',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateOrigin.mockReturnValue(null);
});

describe('POST /api/voice/transcribe', () => {
  describe('input validation', () => {
    it('returns 400 when audio field is missing', async () => {
      const res = await POST(makeRequest(null));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('audio');
    });

    it('returns 400 for empty audio', async () => {
      const emptyBlob = new Blob([], { type: 'audio/webm' });
      const res = await POST(makeRequest(emptyBlob));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('empty');
    });

    it('returns 415 for unsupported MIME type', async () => {
      const badBlob = new Blob(['data'], { type: 'text/plain' });
      const res = await POST(makeRequest(badBlob));
      expect(res.status).toBe(415);
    });
  });

  describe('CSRF validation', () => {
    it('rejects requests that fail CSRF check', async () => {
      const { NextResponse } = await import('next/server');
      mockValidateOrigin.mockReturnValueOnce(
        NextResponse.json({ error: 'CSRF rejected' }, { status: 403 }) as unknown as null,
      );
      const res = await POST(makeRequest());
      expect(res.status).toBe(403);
    });
  });

  describe('successful transcription', () => {
    it('returns transcript from Whisper API', async () => {
      mockWhisperSuccess('Add a new task for the dashboard feature');
      const res = await POST(makeRequest());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.transcript).toBe('Add a new task for the dashboard feature');
    });

    it('trims whitespace from transcript', async () => {
      mockWhisperSuccess('  Hello world  ');
      const res = await POST(makeRequest());
      const data = await res.json();
      expect(data.transcript).toBe('Hello world');
    });

    it('calls Whisper with correct model and language', async () => {
      mockWhisperSuccess('test');
      await POST(makeRequest());

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
      expect((options.headers as Record<string, string>).Authorization).toBe(
        'Bearer test-openai-key',
      );

      const body = options.body as FormData;
      expect(body.get('model')).toBe('whisper-1');
      expect(body.get('language')).toBe('en');
    });
  });

  describe('Whisper API errors', () => {
    it('returns 502 when Whisper API fails', async () => {
      mockWhisperError(500);
      const res = await POST(makeRequest());
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain('Transcription failed');
    });

    it('returns 503 when OPENAI_API_KEY is missing', async () => {
      vi.stubEnv('OPENAI_API_KEY', '');
      const res = await POST(makeRequest());
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toContain('unavailable');
      vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    });
  });
});
