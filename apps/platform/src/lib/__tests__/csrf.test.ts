import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set NODE_ENV before importing
vi.stubEnv('NODE_ENV', 'development');

// Mock @repo/db/service so validateCliToken doesn't make real calls
const mockGetUser = vi
  .fn()
  .mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

import { validateOrigin } from '../csrf';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3002/api/tasks', {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('NODE_ENV', 'development');
  mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
});

describe('validateOrigin', () => {
  it('returns null for allowed localhost origin', async () => {
    const req = makeRequest({ origin: 'http://localhost:3002' });
    expect(await validateOrigin(req)).toBeNull();
  });

  it('returns null for localhost:3000 origin', async () => {
    const req = makeRequest({ origin: 'http://localhost:3000' });
    expect(await validateOrigin(req)).toBeNull();
  });

  it('returns 403 when origin is missing', async () => {
    const req = makeRequest({});
    const res = await validateOrigin(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('returns 403 for disallowed origin', async () => {
    const req = makeRequest({ origin: 'https://evil.com' });
    const res = await validateOrigin(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('allows same-origin when host matches origin', async () => {
    const req = makeRequest({
      origin: 'http://myapp.local:3002',
      host: 'myapp.local:3002',
    });
    expect(await validateOrigin(req)).toBeNull();
  });

  it('allows Railway preview deployments with known project ID', async () => {
    const req = makeRequest({
      origin: 'https://0rybv8w4.up.railway.app',
    });
    expect(await validateOrigin(req)).toBeNull();
  });

  it('rejects Railway deployments with unknown project ID', async () => {
    const req = makeRequest({
      origin: 'https://unknown123.up.railway.app',
    });
    const res = await validateOrigin(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('falls back to referer when origin is missing', async () => {
    const req = makeRequest({
      referer: 'http://localhost:3002/tasks',
    });
    expect(await validateOrigin(req)).toBeNull();
  });

  it('rejects referer from disallowed origin', async () => {
    const req = makeRequest({
      referer: 'https://evil.com/page',
    });
    const res = await validateOrigin(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('allows CLI requests with valid token (bypasses origin check)', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    });

    const req = makeRequest({
      'x-celune-cli': 'true',
      authorization: 'Bearer valid-token',
    });
    expect(await validateOrigin(req)).toBeNull();
  });

  it('rejects CLI requests with invalid token', async () => {
    const req = makeRequest({
      'x-celune-cli': 'true',
      authorization: 'Bearer invalid-token',
    });
    const res = await validateOrigin(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('rejects requests with CLI header but no bearer token', async () => {
    const req = makeRequest({
      'x-celune-cli': 'true',
    });
    const res = await validateOrigin(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});
