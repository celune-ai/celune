/**
 * Shared test utilities for API route tests.
 *
 * Provides reusable mock factories and request builders
 * to reduce boilerplate across test files.
 */
import { vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Supabase chain mock ─────────────────────────────────────────────

/**
 * Creates a chainable Supabase query mock.
 * Every method returns the chain itself by default.
 * Pass overrides to customize specific method return values.
 *
 * Usage:
 *   const chain = makeChain({ data: [...], error: null });
 *   // chain.select().eq().order() all return chain
 *   // chain.data and chain.error resolve as overrides
 */
export function makeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    lt: vi.fn(),
    gt: vi.fn(),
    not: vi.fn(),
    is: vi.fn(),
    like: vi.fn(),
    ilike: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  };
  for (const key of Object.keys(chain)) {
    (chain[key] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  }
  Object.assign(chain, overrides);
  return chain;
}

export type Chain = ReturnType<typeof makeChain>;

// ── Request builder ─────────────────────────────────────────────────

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  searchParams?: Record<string, string>;
}

const DEFAULT_HEADERS: Record<string, string> = {
  'x-user-id': 'test-user-123',
  origin: 'http://localhost:3002',
};

/**
 * Creates a NextRequest for testing API routes.
 *
 * Usage:
 *   const req = makeRequest('/api/tasks', { method: 'POST', body: { title: 'Test' } });
 *   const req = makeRequest('/api/analytics/velocity', { searchParams: { workspace_id: 'ws-1' } });
 */
export function makeRequest(path: string, options: RequestOptions = {}): NextRequest {
  const { method = 'GET', headers = {}, body, searchParams = {} } = options;

  const url = new URL(`http://localhost:3002${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  const mergedHeaders = { ...DEFAULT_HEADERS, ...headers };
  const init: RequestInit = { method, headers: mergedHeaders };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (mergedHeaders as Record<string, string>)['content-type'] = 'application/json';
  }

  return new NextRequest(url, init as never);
}

/**
 * Creates a workspace-scoped GET request (most common pattern).
 */
export function makeWorkspaceRequest(
  path: string,
  workspaceId = 'ws-test-123',
  extra: RequestOptions = {},
): NextRequest {
  return makeRequest(path, {
    ...extra,
    searchParams: { workspace_id: workspaceId, ...extra.searchParams },
  });
}

// ── Response helpers ────────────────────────────────────────────────

/**
 * Parse a NextResponse body as JSON.
 */
export async function parseResponse<T = unknown>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}
