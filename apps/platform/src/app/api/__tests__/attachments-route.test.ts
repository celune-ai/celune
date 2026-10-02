import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mocks ---

const mockUpload = vi.fn();
const mockRemove = vi.fn();
const mockCreateSignedUrl = vi.fn();

// Table-specific chain builders — each .from(table) returns a fresh chain
function makeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    single: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  };
  // Default: every method returns the chain itself for chaining
  for (const key of Object.keys(chain)) {
    chain[key].mockReturnValue(chain);
  }
  // Apply overrides
  for (const [key, value] of Object.entries(overrides)) {
    chain[key] = value as ReturnType<typeof vi.fn>;
  }
  return chain;
}

// Per-test table configurations
let tableHandlers: Record<string, ReturnType<typeof makeChain>>;
const mockFrom = vi.fn((table: string) => {
  return tableHandlers[table] ?? makeChain();
});

vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'test-user-id' } } }) },
    from: mockFrom,
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        remove: mockRemove,
        createSignedUrl: mockCreateSignedUrl,
      })),
    },
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
  };
});

vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(() => 'test-user-id'),
}));

vi.mock('@repo/db/queries', () => ({
  createActivity: vi.fn(async () => undefined),
}));

// Mock randomUUID via node:crypto
vi.mock('node:crypto', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    randomUUID: () => 'test-uuid-1234',
  };
});

import { GET, POST } from '../../api/tasks/[id]/attachments/route';
import { DELETE } from '../../api/tasks/[id]/attachments/[attachmentId]/route';

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeDeleteParams(id: string, attachmentId: string) {
  return { params: Promise.resolve({ id, attachmentId }) };
}

function createMockFile(name: string, size: number, type: string): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  tableHandlers = {};
});

// --- GET tests ---

describe('GET /api/tasks/[id]/attachments', () => {
  it('returns attachments with signed URLs', async () => {
    const attachments = [
      { id: 'att-1', task_id: 'task-1', file_name: 'test.png', storage_path: 'task-1/test.png' },
    ];
    const chain = makeChain();
    chain.order.mockResolvedValueOnce({ data: attachments, error: null });
    tableHandlers['task_attachments'] = chain;

    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://signed-url.example.com/test.png' },
    });

    const res = await GET(makeRequest('/api/tasks/task-1/attachments'), makeParams('task-1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].download_url).toBe('https://signed-url.example.com/test.png');
  });

  it('returns empty array when no attachments', async () => {
    const chain = makeChain();
    chain.order.mockResolvedValueOnce({ data: [], error: null });
    tableHandlers['task_attachments'] = chain;

    const res = await GET(makeRequest('/api/tasks/task-1/attachments'), makeParams('task-1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it('returns 500 on database error', async () => {
    const chain = makeChain();
    chain.order.mockResolvedValueOnce({ data: null, error: new Error('DB error') });
    tableHandlers['task_attachments'] = chain;

    const res = await GET(makeRequest('/api/tasks/task-1/attachments'), makeParams('task-1'));
    expect(res.status).toBe(500);
  });
});

// --- POST tests ---

describe('POST /api/tasks/[id]/attachments', () => {
  function setupTaskExists(exists: boolean) {
    const tasksChain = makeChain();
    if (exists) {
      tasksChain.single.mockResolvedValue({ data: { id: 'task-1' }, error: null });
    } else {
      tasksChain.single.mockResolvedValue({ data: null, error: { message: 'not found' } });
    }
    tableHandlers['tasks'] = tasksChain;
  }

  function setupAttachmentsInsert(result: { data: unknown; error: unknown }) {
    const attChain = makeChain();
    // insert() returns a new chain with .select().single()
    const insertSelectSingle = vi.fn().mockResolvedValue(result);
    const insertSelect = vi.fn().mockReturnValue({ single: insertSelectSingle });
    attChain.insert.mockReturnValue({ select: insertSelect });
    tableHandlers['task_attachments'] = attChain;
  }

  beforeEach(() => {
    setupTaskExists(true);
  });

  it('returns 404 when task not found', async () => {
    setupTaskExists(false);

    const formData = new FormData();
    formData.append('files', createMockFile('test.png', 100, 'image/png'));

    const req = new NextRequest(new URL('/api/tasks/task-1/attachments', 'http://localhost:3002'), {
      method: 'POST',
    } as never);
    Object.defineProperty(req, 'formData', { value: vi.fn().mockResolvedValue(formData) });

    const res = await POST(req, makeParams('task-1'));
    expect(res.status).toBe(404);
  });

  it('returns 400 when no files provided', async () => {
    const formData = new FormData();
    const req = new NextRequest(new URL('/api/tasks/task-1/attachments', 'http://localhost:3002'), {
      method: 'POST',
    } as never);
    Object.defineProperty(req, 'formData', { value: vi.fn().mockResolvedValue(formData) });

    const res = await POST(req, makeParams('task-1'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('No files');
  });

  it('rejects files exceeding 10MB', async () => {
    const formData = new FormData();
    formData.append('files', createMockFile('big.png', 11 * 1024 * 1024, 'image/png'));

    const req = new NextRequest(new URL('/api/tasks/task-1/attachments', 'http://localhost:3002'), {
      method: 'POST',
    } as never);
    Object.defineProperty(req, 'formData', { value: vi.fn().mockResolvedValue(formData) });

    const res = await POST(req, makeParams('task-1'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0].error).toContain('10MB');
  });

  it('rejects disallowed MIME types', async () => {
    const formData = new FormData();
    formData.append('files', createMockFile('malware.exe', 100, 'application/x-msdownload'));

    const req = new NextRequest(new URL('/api/tasks/task-1/attachments', 'http://localhost:3002'), {
      method: 'POST',
    } as never);
    Object.defineProperty(req, 'formData', { value: vi.fn().mockResolvedValue(formData) });

    const res = await POST(req, makeParams('task-1'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0].error).toContain('not allowed');
  });

  it('uploads valid file and returns 201', async () => {
    mockUpload.mockResolvedValueOnce({ error: null });
    setupAttachmentsInsert({
      data: {
        id: 'att-1',
        task_id: 'task-1',
        file_name: 'test.png',
        file_size: 100,
        mime_type: 'image/png',
        storage_path: 'task-1/test-uuid-1234_test.png',
      },
      error: null,
    });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://signed.example.com/test.png' },
    });

    const formData = new FormData();
    formData.append('files', createMockFile('test.png', 100, 'image/png'));

    const req = new NextRequest(new URL('/api/tasks/task-1/attachments', 'http://localhost:3002'), {
      method: 'POST',
    } as never);
    Object.defineProperty(req, 'formData', { value: vi.fn().mockResolvedValue(formData) });

    const res = await POST(req, makeParams('task-1'));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.attachments).toHaveLength(1);
    expect(data.attachments[0].file_name).toBe('test.png');
  });

  it('handles storage upload failure', async () => {
    mockUpload.mockResolvedValueOnce({ error: { message: 'Storage quota exceeded' } });

    const formData = new FormData();
    formData.append('files', createMockFile('test.png', 100, 'image/png'));

    const req = new NextRequest(new URL('/api/tasks/task-1/attachments', 'http://localhost:3002'), {
      method: 'POST',
    } as never);
    Object.defineProperty(req, 'formData', { value: vi.fn().mockResolvedValue(formData) });

    const res = await POST(req, makeParams('task-1'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0].error).toContain('Storage quota');
  });
});

// --- DELETE tests ---

describe('DELETE /api/tasks/[id]/attachments/[attachmentId]', () => {
  function setupAttachmentFetch(
    fetchResult: { data: unknown; error: unknown },
    deleteResult: { error: unknown } = { error: null },
  ) {
    const chain = makeChain();
    // The route calls from('task_attachments') twice:
    //   1. select('*').eq('id', attachmentId).eq('task_id', id).single()
    //   2. delete().eq('id', attachmentId)
    // eq is called 3 times total: 2 in the select chain, 1 in the delete chain.
    // single() resolves the fetch result.
    chain.single.mockResolvedValueOnce(fetchResult);
    // The 3rd eq call (in the delete chain) should resolve the delete result.
    // First 2 eq calls return the chain (for chaining), 3rd resolves.
    chain.eq
      .mockReturnValueOnce(chain) // eq('id', attachmentId) in select
      .mockReturnValueOnce(chain) // eq('task_id', id) in select — continues to .single()
      .mockResolvedValueOnce(deleteResult); // eq('id', attachmentId) in delete
    tableHandlers['task_attachments'] = chain;
    return chain;
  }

  it('deletes attachment and returns 204', async () => {
    const chain = setupAttachmentFetch({
      data: { id: 'att-1', task_id: 'task-1', storage_path: 'task-1/file.png' },
      error: null,
    });
    // The second .from('task_attachments') call for delete needs its own chain
    // But since mockFrom returns the same handler per table, we need the delete chain to work too.
    // After .single() resolves (fetch), the route calls .from('task_attachments').delete().eq()
    // The chain's delete() returns the chain, and then eq() resolves.
    // We already set chain.eq.mockResolvedValueOnce above.
    mockRemove.mockResolvedValueOnce({ error: null });

    const res = await DELETE(
      makeRequest('/api/tasks/task-1/attachments/att-1', { method: 'DELETE' }),
      makeDeleteParams('task-1', 'att-1'),
    );
    expect(res.status).toBe(204);
  });

  it('returns 404 when attachment not found', async () => {
    // For 404, only the fetch chain runs (no delete), so use a simple setup
    const chain = makeChain();
    chain.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    tableHandlers['task_attachments'] = chain;

    const res = await DELETE(
      makeRequest('/api/tasks/task-1/attachments/bad-id', { method: 'DELETE' }),
      makeDeleteParams('task-1', 'bad-id'),
    );
    expect(res.status).toBe(404);
  });

  it('continues DB delete even when storage delete fails', async () => {
    setupAttachmentFetch({
      data: { id: 'att-1', task_id: 'task-1', storage_path: 'task-1/file.png' },
      error: null,
    });
    mockRemove.mockResolvedValueOnce({ error: { message: 'Storage error' } });

    const res = await DELETE(
      makeRequest('/api/tasks/task-1/attachments/att-1', { method: 'DELETE' }),
      makeDeleteParams('task-1', 'att-1'),
    );
    expect(res.status).toBe(204);
  });
});
