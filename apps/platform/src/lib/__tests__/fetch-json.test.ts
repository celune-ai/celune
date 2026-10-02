import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fetchJson, _resetSessionExpiredFlag } from '../fetch-json';

// Track window.location.href assignments
let locationHrefSetter: (...args: unknown[]) => void;

beforeEach(() => {
  locationHrefSetter = vi.fn();
  // Reset the module-level debounce flag by re-importing
  // For tests we mock window.location
  const loc = {
    pathname: '/tasks',
    origin: 'http://localhost:3000',
    get href() {
      return `http://localhost:3000${loc.pathname}`;
    },
    set href(val: string) {
      locationHrefSetter(val);
    },
  };
  Object.defineProperty(window, 'location', {
    value: loc,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetSessionExpiredFlag();
});

describe('fetchJson', () => {
  it('returns parsed JSON on 200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const result = await fetchJson<{ ok: boolean }>('/api/test');
    expect(result).toEqual({ ok: true });
  });

  it('throws on non-2xx response with status and body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not found', { status: 404 }));

    await expect(fetchJson('/api/missing')).rejects.toThrow('HTTP 404: Not found');
  });

  it('throws on 500 with empty body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));

    await expect(fetchJson('/api/error')).rejects.toThrow('HTTP 500');
  });

  it('passes options through to fetch', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await fetchJson('/api/test', { method: 'POST', body: '{}' });
    expect(spy).toHaveBeenCalledWith('/api/test', { method: 'POST', body: '{}' });
  });

  it('truncates long error bodies to 200 chars', async () => {
    const longBody = 'x'.repeat(300);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(longBody, { status: 400 }));

    await expect(fetchJson('/api/long-error')).rejects.toThrow(`HTTP 400: ${'x'.repeat(200)}`);
  });

  it('redirects to /login on 401 with session_expired reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(fetchJson('/api/data')).rejects.toThrow('HTTP 401');
    expect(locationHrefSetter).toHaveBeenCalledWith(
      'http://localhost:3000/login?reason=session_expired',
    );
  });

  it('does not redirect on 401 when already on login page', async () => {
    Object.defineProperty(window.location, 'pathname', { value: '/login', configurable: true });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(fetchJson('/api/data')).rejects.toThrow('HTTP 401');
    expect(locationHrefSetter).not.toHaveBeenCalled();
  });

  it('debounces multiple simultaneous 401 redirects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await Promise.allSettled([fetchJson('/api/a'), fetchJson('/api/b'), fetchJson('/api/c')]);

    expect(locationHrefSetter).toHaveBeenCalledTimes(1);
  });

  it('does not redirect on non-401 errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Forbidden', { status: 403 }));

    await expect(fetchJson('/api/data')).rejects.toThrow('HTTP 403');
    expect(locationHrefSetter).not.toHaveBeenCalled();
  });
});
