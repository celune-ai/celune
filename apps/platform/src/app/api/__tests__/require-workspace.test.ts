import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockSingle = vi.fn();
const mockEq = vi.fn().mockReturnThis();
const mockSelect = vi.fn(() => ({ eq: mockEq }));

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      eq: mockEq,
    })),
  })),
}));

vi.mock('@repo/db/validation', () => ({
  isValidUuid: vi.fn((id: string) => /^[0-9a-f-]{36}$/.test(id)),
}));

/* ------------------------------------------------------------------ */
/*  Imports (after mocks)                                              */
/* ------------------------------------------------------------------ */

import { extractWorkspaceScope, extractRequiredWorkspaceId } from '@/lib/require-workspace';

/* ------------------------------------------------------------------ */
/*  Tests: extractWorkspaceScope                                       */
/* ------------------------------------------------------------------ */

describe('extractWorkspaceScope', () => {
  function makeReq(params: Record<string, string> = {}): NextRequest {
    const url = new URL('http://localhost:3002/api/test');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return new NextRequest(url);
  }

  it('returns 400 when no workspace params provided', () => {
    const result = extractWorkspaceScope(makeReq());
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  it('returns workspace_id scope for single workspace', () => {
    const result = extractWorkspaceScope(
      makeReq({ workspace_id: '12345678-1234-1234-1234-123456789012' }),
    );
    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toEqual({ workspace_id: '12345678-1234-1234-1234-123456789012' });
  });

  it('returns workspace_ids scope for multiple workspaces', () => {
    const result = extractWorkspaceScope(
      makeReq({
        workspace_ids: '12345678-1234-1234-1234-123456789012,87654321-4321-4321-4321-210987654321',
      }),
    );
    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toEqual({
      workspace_ids: [
        '12345678-1234-1234-1234-123456789012',
        '87654321-4321-4321-4321-210987654321',
      ],
    });
  });

  it('returns 400 for invalid UUID in workspace_id', () => {
    const result = extractWorkspaceScope(makeReq({ workspace_id: 'not-a-uuid' }));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  it('returns 400 for invalid UUID in workspace_ids', () => {
    const result = extractWorkspaceScope(makeReq({ workspace_ids: 'not-a-uuid,also-bad' }));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  it('prefers workspace_ids over workspace_id when both provided', () => {
    const result = extractWorkspaceScope(
      makeReq({
        workspace_id: '12345678-1234-1234-1234-123456789012',
        workspace_ids: '87654321-4321-4321-4321-210987654321',
      }),
    );
    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toHaveProperty('workspace_ids');
  });
});

/* ------------------------------------------------------------------ */
/*  Tests: extractRequiredWorkspaceId                                  */
/* ------------------------------------------------------------------ */

describe('extractRequiredWorkspaceId', () => {
  function makeReq(params: Record<string, string> = {}): NextRequest {
    const url = new URL('http://localhost:3002/api/test');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return new NextRequest(url);
  }

  it('returns 400 when workspace_id is missing', () => {
    const result = extractRequiredWorkspaceId(makeReq());
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  it('returns workspace_id string when valid', () => {
    const result = extractRequiredWorkspaceId(
      makeReq({ workspace_id: '12345678-1234-1234-1234-123456789012' }),
    );
    expect(result).toBe('12345678-1234-1234-1234-123456789012');
  });

  it('returns 400 for invalid UUID', () => {
    const result = extractRequiredWorkspaceId(makeReq({ workspace_id: 'bad' }));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });
});
