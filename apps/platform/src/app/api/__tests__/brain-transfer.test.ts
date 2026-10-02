/**
 * Brain export/import tests: export shape and workspace scoping, merge and
 * overwrite semantics, version rejection, and route auth.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { gzipSync } from 'node:zlib';
import { FakeDb, type Row } from './fake-supabase';

const fakeDb = new FakeDb();

const mockSupabase = { auth: { getUser: vi.fn() } };

vi.mock('@repo/db/service', () => ({ createServiceClient: () => fakeDb }));
vi.mock('@repo/db/server', () => ({ createClient: () => Promise.resolve(mockSupabase) }));
vi.mock('@repo/db/validation', () => ({ isValidUuid: vi.fn(() => true) }));
vi.mock('@/lib/csrf', () => ({ validateOrigin: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_READ: { limit: 120, windowMs: 60000 },
  RATE_WRITE: { limit: 60, windowMs: 60000 },
}));
vi.mock('@/lib/require-workspace', () => ({
  requireWorkspaceMembership: vi.fn(async () => null),
}));
const granted = new Set<string>(['memory:read', 'memory:write', 'memory:delete']);
vi.mock('@/lib/permissions', () => ({
  resolvePermissions: vi.fn(async () => ({
    role: 'member',
    permissions: new Set(granted),
    isOwner: false,
    isPlatformOwner: false,
  })),
}));
vi.mock('@/lib/security-audit', () => ({ logPermissionDenied: vi.fn() }));
vi.mock('@/lib/api-key-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-key-auth')>()),
  authenticateApiKey: vi.fn(async () => null),
}));

const WS1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const WS2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const USER = 'bbbbbbbb-0000-4000-8000-000000000001';
const ORG = 'cccccccc-0000-4000-8000-000000000001';
const M1 = 'dddddddd-0000-4000-8000-000000000001';
const M2 = 'dddddddd-0000-4000-8000-000000000002';
const M3 = 'dddddddd-0000-4000-8000-000000000003';
const M4 = 'dddddddd-0000-4000-8000-000000000004';
const M9 = 'dddddddd-0000-4000-8000-000000000009';
const R1 = 'eeeeeeee-0000-4000-8000-000000000001';
const R2 = 'eeeeeeee-0000-4000-8000-000000000002';
const R3 = 'eeeeeeee-0000-4000-8000-000000000003';
const MF1 = 'ffffffff-0000-4000-8000-000000000001';
const MF2 = 'ffffffff-0000-4000-8000-000000000002';
const T1 = '99999999-0000-4000-8000-000000000001';

function memory(id: string, workspace_id: string, key: string, content: string, extra: Row = {}) {
  return {
    id,
    workspace_id,
    org_id: ORG,
    user_id: USER,
    key,
    content,
    category: 'fact',
    memory_type: 'fact',
    tags: '',
    source: 'test',
    agent_id: 'system',
    version: 1,
    importance_score: 0.5,
    is_core: false,
    is_archived: false,
    access_count: 0,
    embedding: [0.1, 0.2],
    fts: 'tsv',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...extra,
  };
}

function seedTwoWorkspaces() {
  fakeDb.seed('workspaces', [
    { id: WS1, org_id: ORG },
    { id: WS2, org_id: ORG },
  ]);
  fakeDb.seed('agent_memory', [
    memory(M1, WS1, 'ws1-a', 'alpha'),
    memory(M2, WS1, 'ws1-b', 'beta'),
    memory(M9, WS2, 'ws2-a', 'other workspace'),
  ]);
  fakeDb.seed('memory_relations', [
    {
      id: R1,
      workspace_id: WS1,
      memory_id: M1,
      related_type: 'memory',
      related_id: M2,
      relation_type: 'supports',
      confidence: 1,
      is_auto_detected: false,
      detected_by: null,
      created_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: R2,
      workspace_id: WS2,
      memory_id: M9,
      related_type: 'task',
      related_id: T1,
      relation_type: 'context_for',
      confidence: 1,
      is_auto_detected: false,
      detected_by: null,
      created_at: '2026-09-01T00:00:00.000Z',
    },
  ]);
  fakeDb.seed('brain_manifest', [
    {
      id: MF1,
      workspace_id: WS1,
      org_id: ORG,
      path: 'skills/task/SKILL.md',
      content_hash: 'h1',
      version: '1.0.0',
      tier: 'essential',
      category: 'skill',
      ownership_scope: 'core',
      is_core: true,
      is_forked: false,
      update_available: false,
      tags: [],
      install_source: 'bootstrap',
      is_enabled: true,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: MF2,
      workspace_id: WS2,
      org_id: ORG,
      path: 'skills/other/SKILL.md',
      content_hash: 'h2',
      version: '1.0.0',
      tier: 'essential',
      category: 'skill',
      is_core: true,
      is_forked: false,
      update_available: false,
      tags: [],
      is_enabled: true,
    },
  ]);
  fakeDb.seed('brain_section_hashes', [
    { id: 's1', manifest_id: MF1, section_key: 'intro', content_hash: 'sh1', is_forked: false },
    { id: 's2', manifest_id: MF2, section_key: 'intro', content_hash: 'sh2', is_forked: false },
  ]);
}

function makeFile(overrides: Row = {}) {
  return {
    format: 'celune-brain',
    format_version: 1,
    exported_at: '2026-09-27T00:00:00.000Z',
    source: { workspace_id: WS2 },
    agent_memory: [
      { id: M1, key: 'ws1-a', category: 'fact', content: 'alpha' },
      { id: M3, key: 'imported-b', category: 'fact', content: 'beta' },
      { id: M4, key: 'imported-c', category: 'decision', content: 'gamma', importance_score: 0.9 },
    ],
    memory_relations: [
      // M1 -> M3: M3 dedupes onto M2 by content hash, so this lands as M1 -> M2 (already present).
      { id: R1, memory_id: M1, related_type: 'memory', related_id: M3, relation_type: 'supports' },
      // New edge into the newly inserted memory.
      {
        id: R3,
        memory_id: M4,
        related_type: 'memory',
        related_id: M1,
        relation_type: 'elaborates',
      },
      // Points at a memory that is not in the file or the workspace: dropped.
      { id: R2, memory_id: M9, related_type: 'task', related_id: T1, relation_type: 'context_for' },
    ],
    brain_manifest: [
      {
        id: MF1,
        path: 'skills/task/SKILL.md',
        content_hash: 'h1',
        tier: 'essential',
        category: 'skill',
      },
      {
        id: MF2,
        path: 'skills/new/SKILL.md',
        content_hash: 'h3',
        tier: 'standard',
        category: 'skill',
        sections: [{ section_key: 'intro', content_hash: 'sh3' }],
      },
    ],
    ...overrides,
  };
}

function createRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    rawBody?: Uint8Array;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const init: RequestInit & { duplex?: string } = {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  };
  if (options.rawBody) {
    init.body = options.rawBody as unknown as BodyInit;
    init.duplex = 'half';
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

// Cold route imports can exceed the per-test timeout on a loaded machine.
beforeAll(async () => {
  await import('@/app/api/brain/export/route');
  await import('@/app/api/brain/import/route');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.tables.clear();
  seedTwoWorkspaces();
});

describe('brain-transfer library', () => {
  it('exports only the calling workspace and strips tenant and embedding columns', async () => {
    const { exportToObject } = await import('@/lib/brain-transfer');
    const file = await exportToObject(fakeDb as never, WS1);

    expect(file.format).toBe('celune-brain');
    expect(file.format_version).toBe(1);
    expect(file.counts).toEqual({ agent_memory: 2, memory_relations: 1, brain_manifest: 1 });
    expect(file.agent_memory.map((m) => m.id).sort()).toEqual([M1, M2]);
    expect(file.memory_relations.map((r) => r.id)).toEqual([R1]);
    expect(file.brain_manifest.map((m) => m.id)).toEqual([MF1]);
    expect(file.brain_manifest[0].sections).toEqual([
      { section_key: 'intro', content_hash: 'sh1', is_forked: false },
    ]);

    const row = file.agent_memory[0] as Row;
    for (const col of ['workspace_id', 'org_id', 'user_id', 'embedding', 'fts']) {
      expect(row).not.toHaveProperty(col);
    }
  });

  it('merge dedupes on id, content hash, and key, and remaps relations', async () => {
    const { importBrain, parseExportFile } = await import('@/lib/brain-transfer');
    const file = parseExportFile(makeFile());
    const result = await importBrain(
      fakeDb as never,
      { workspaceId: WS1, orgId: ORG, userId: USER },
      file,
      'merge',
    );

    expect(result.mode).toBe('merge');
    expect(result.deleted).toBeUndefined();
    expect(result.counts.agent_memory).toEqual({ inserted: 1, skipped: 2 });
    expect(result.counts.memory_relations).toEqual({ inserted: 1, skipped: 2 });
    expect(result.counts.brain_manifest).toEqual({ inserted: 1, skipped: 1 });

    const memories = fakeDb.rows('agent_memory').filter((r) => r.workspace_id === WS1);
    expect(memories).toHaveLength(3);
    const gamma = memories.find((r) => r.id === M4)!;
    expect(gamma).toMatchObject({
      workspace_id: WS1,
      org_id: ORG,
      user_id: USER,
      key: 'imported-c',
    });
    expect(gamma).not.toHaveProperty('embedding');

    const relations = fakeDb.rows('memory_relations').filter((r) => r.workspace_id === WS1);
    expect(relations).toHaveLength(2);
    expect(relations.find((r) => r.id === R3)).toMatchObject({ memory_id: M4, related_id: M1 });

    // MF2 already exists in WS2, so the new manifest row gets a fresh id and its sections follow it.
    const newManifest = fakeDb
      .rows('brain_manifest')
      .find((m) => m.workspace_id === WS1 && m.path === 'skills/new/SKILL.md')!;
    expect(newManifest.id).not.toBe(MF2);
    expect(newManifest).toMatchObject({ org_id: ORG, content_hash: 'h3' });
    const sections = fakeDb
      .rows('brain_section_hashes')
      .filter((s) => s.manifest_id === newManifest.id);
    expect(sections).toEqual([
      expect.objectContaining({ section_key: 'intro', content_hash: 'sh3' }),
    ]);
    expect(fakeDb.rows('brain_section_hashes').find((s) => s.id === 's2')).toMatchObject({
      manifest_id: MF2,
      content_hash: 'sh2',
    });
    // The other workspace is untouched.
    expect(fakeDb.rows('agent_memory').filter((r) => r.workspace_id === WS2)).toHaveLength(1);
    expect(fakeDb.rows('brain_manifest').filter((r) => r.workspace_id === WS2)).toHaveLength(1);
  });

  it('assigns a fresh id when the file id already exists in another workspace', async () => {
    const { importBrain, parseExportFile } = await import('@/lib/brain-transfer');
    const file = parseExportFile(
      makeFile({
        agent_memory: [{ id: M9, key: 'from-ws2', category: 'fact', content: 'collides on id' }],
        memory_relations: [
          {
            id: R2,
            memory_id: M9,
            related_type: 'memory',
            related_id: M9,
            relation_type: 'supports',
          },
        ],
        brain_manifest: [],
      }),
    );
    const result = await importBrain(
      fakeDb as never,
      { workspaceId: WS1, orgId: ORG, userId: USER },
      file,
      'merge',
    );

    expect(result.counts.agent_memory).toEqual({ inserted: 1, skipped: 0 });
    const inserted = fakeDb.rows('agent_memory').find((r) => r.key === 'from-ws2')!;
    expect(inserted.id).not.toBe(M9);
    expect(inserted.workspace_id).toBe(WS1);
    const relation = fakeDb
      .rows('memory_relations')
      .find(
        (r) =>
          r.workspace_id === WS1 && r.relation_type === 'supports' && r.memory_id === inserted.id,
      );
    expect(relation).toMatchObject({ memory_id: inserted.id, related_id: inserted.id });
    expect(relation!.id).not.toBe(R2);
    expect(fakeDb.rows('agent_memory').find((r) => r.id === M9)!.workspace_id).toBe(WS2);
  });

  it('drops relations whose task, skill, or memory target is outside the target workspace', async () => {
    const LOCAL_TASK = '99999999-0000-4000-8000-000000000002';
    const FOREIGN_SKILL = '99999999-0000-4000-8000-000000000003';
    fakeDb.seed('tasks', [
      { id: LOCAL_TASK, workspace_id: WS1 },
      { id: T1, workspace_id: WS2 },
    ]);
    fakeDb.seed('skills', [{ id: FOREIGN_SKILL, workspace_id: WS2 }]);
    const edge = (id: string, related_type: string, related_id: string) => ({
      id,
      memory_id: M4,
      related_type,
      related_id,
      relation_type: 'context_for',
    });
    const { importBrain, parseExportFile } = await import('@/lib/brain-transfer');
    const file = parseExportFile(
      makeFile({
        memory_relations: [
          edge('eeeeeeee-0000-4000-8000-000000000011', 'task', LOCAL_TASK),
          edge('eeeeeeee-0000-4000-8000-000000000012', 'task', T1),
          edge('eeeeeeee-0000-4000-8000-000000000013', 'skill', FOREIGN_SKILL),
          edge('eeeeeeee-0000-4000-8000-000000000014', 'memory', M9),
        ],
        brain_manifest: [],
      }),
    );
    const result = await importBrain(
      fakeDb as never,
      { workspaceId: WS1, orgId: ORG, userId: USER },
      file,
      'merge',
    );

    expect(result.counts.memory_relations).toEqual({ inserted: 1, skipped: 3 });
    const landed = fakeDb
      .rows('memory_relations')
      .filter((r) => r.workspace_id === WS1 && r.memory_id === M4);
    expect(landed.map((r) => r.related_id)).toEqual([LOCAL_TASK]);
  });

  it('overwrite replaces the workspace rows and reports deleted counts', async () => {
    const { importBrain, parseExportFile } = await import('@/lib/brain-transfer');
    const file = parseExportFile(makeFile());
    const result = await importBrain(
      fakeDb as never,
      { workspaceId: WS1, orgId: ORG, userId: USER },
      file,
      'overwrite',
    );

    expect(result.deleted).toEqual({ agent_memory: 2, memory_relations: 1, brain_manifest: 1 });
    expect(result.counts.agent_memory).toEqual({ inserted: 3, skipped: 0 });
    // M9 is not in the workspace, so its relation is dropped; the other two land.
    expect(result.counts.memory_relations).toEqual({ inserted: 2, skipped: 1 });
    expect(result.counts.brain_manifest).toEqual({ inserted: 2, skipped: 0 });

    const memories = fakeDb.rows('agent_memory').filter((r) => r.workspace_id === WS1);
    expect(memories.map((r) => r.id).sort()).toEqual([M1, M3, M4]);
    expect(fakeDb.rows('agent_memory').filter((r) => r.workspace_id === WS2)).toHaveLength(1);
    expect(fakeDb.rows('memory_relations').filter((r) => r.workspace_id === WS2)).toHaveLength(1);
  });

  it('rejects unknown format versions and foreign formats', async () => {
    const { parseExportFile } = await import('@/lib/brain-transfer');

    expect(() => parseExportFile(makeFile({ format_version: 2 }))).toThrowError(
      /Unsupported brain export format_version 2\. This server supports: 1/,
    );
    expect(() => parseExportFile(makeFile({ format_version: 2 }))).toThrowError(
      expect.objectContaining({ code: 'unsupported_format_version', status: 400 }),
    );
    expect(() => parseExportFile({ format: 'something-else', format_version: 1 })).toThrowError(
      /Unrecognized export format/,
    );
    expect(() => parseExportFile('nope')).toThrowError(/must be a brain export document/);
    expect(() =>
      parseExportFile(
        makeFile({
          agent_memory: [{ id: 'not-a-uuid', key: 'k', category: 'fact', content: 'x' }],
        }),
      ),
    ).toThrowError(/Invalid brain export file at agent_memory\.0\.id/);
  });

  it('parses the import mode', async () => {
    const { importQuerySchema } = await import('@/lib/brain-transfer');
    expect(importQuerySchema.parse({}).mode).toBe('merge');
    expect(importQuerySchema.parse({ mode: 'overwrite' }).mode).toBe('overwrite');
    expect(importQuerySchema.safeParse({ mode: 'replace' }).success).toBe(false);
  });
});

describe('GET /api/brain/export', () => {
  it('returns 401 without a session or API key', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });
    const { GET } = await import('@/app/api/brain/export/route');
    const res = await GET(createRequest(`/api/brain/export?workspace_id=${WS1}`));
    expect(res.status).toBe(401);
  });

  it('streams the session user workspace only', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER } } });
    const { GET } = await import('@/app/api/brain/export/route');
    const res = await GET(createRequest(`/api/brain/export?workspace_id=${WS1}`));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-disposition')).toMatch(/celune-brain-aaaaaaaa-.*\.json"$/);
    const file = JSON.parse(await res.text());
    expect(file.format_version).toBe(1);
    expect(file.agent_memory.map((m: Row) => m.id).sort()).toEqual([M1, M2]);
    expect(file.brain_manifest.map((m: Row) => m.id)).toEqual([MF1]);
  });

  it('gzips when asked', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER } } });
    const { GET } = await import('@/app/api/brain/export/route');
    const res = await GET(createRequest(`/api/brain/export?workspace_id=${WS1}&compress=true`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
  });

  it('uses the API key workspace and requires read scope', async () => {
    const { authenticateApiKey } = await import('@/lib/api-key-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      keyId: 'k1',
      workspaceId: WS2,
      orgId: ORG,
      userId: USER,
      scopes: ['read'],
      environment: 'live',
      realtimeEnabled: false,
    });
    const { GET } = await import('@/app/api/brain/export/route');
    const res = await GET(createRequest('/api/brain/export'));
    expect(res.status).toBe(200);
    const file = JSON.parse(await res.text());
    expect(file.source.workspace_id).toBe(WS2);
    expect(file.agent_memory.map((m: Row) => m.id)).toEqual([M9]);
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/brain/import', () => {
  it('rejects an unsupported format_version with a clear error', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER } } });
    const { POST } = await import('@/app/api/brain/import/route');
    const res = await POST(
      createRequest(`/api/brain/import?workspace_id=${WS1}`, {
        method: 'POST',
        body: makeFile({ format_version: 99 }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('unsupported_format_version');
    expect(body.error).toContain('This server supports: 1');
    expect(fakeDb.rows('agent_memory')).toHaveLength(3);
  });

  it('rejects an unknown mode', async () => {
    const { POST } = await import('@/app/api/brain/import/route');
    const res = await POST(
      createRequest(`/api/brain/import?workspace_id=${WS1}&mode=replace`, {
        method: 'POST',
        body: makeFile(),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_mode');
  });

  it('checks Origin for session callers and skips it for API keys', async () => {
    const { validateOrigin } = await import('@/lib/csrf');
    const { authenticateApiKey } = await import('@/lib/api-key-auth');
    const { POST } = await import('@/app/api/brain/import/route');

    (validateOrigin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      Response.json({ error: 'Invalid origin' }, { status: 403 }),
    );
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER } } });
    const blocked = await POST(
      createRequest(`/api/brain/import?workspace_id=${WS1}`, { method: 'POST', body: makeFile() }),
    );
    expect(blocked.status).toBe(403);
    expect(fakeDb.rows('agent_memory')).toHaveLength(3);

    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      keyId: 'k1',
      workspaceId: WS1,
      orgId: ORG,
      userId: USER,
      scopes: ['write'],
      environment: 'live',
      realtimeEnabled: false,
    });
    const viaKey = await POST(
      createRequest('/api/brain/import', { method: 'POST', body: makeFile() }),
    );
    expect(viaKey.status).toBe(200);
    expect(validateOrigin).toHaveBeenCalledTimes(1);
  });

  it('merges by default and returns counts', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER } } });
    const { POST } = await import('@/app/api/brain/import/route');
    const res = await POST(
      createRequest(`/api/brain/import?workspace_id=${WS1}`, { method: 'POST', body: makeFile() }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('merge');
    expect(body.counts.agent_memory).toEqual({ inserted: 1, skipped: 2 });
  });

  it('accepts a gzip body and honors mode=overwrite', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER } } });
    const { POST } = await import('@/app/api/brain/import/route');
    const gz = new Uint8Array(gzipSync(Buffer.from(JSON.stringify(makeFile()))));
    const res = await POST(
      createRequest(`/api/brain/import?workspace_id=${WS1}&mode=overwrite`, {
        method: 'POST',
        rawBody: gz,
        headers: { 'Content-Type': 'application/gzip' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('overwrite');
    expect(body.deleted).toEqual({ agent_memory: 2, memory_relations: 1, brain_manifest: 1 });
    expect(body.counts.agent_memory).toEqual({ inserted: 3, skipped: 0 });
  });

  it('rejects a gzip body that inflates past the decompressed cap', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER } } });
    const { POST } = await import('@/app/api/brain/import/route');
    const { MAX_DECOMPRESSED_BYTES } = await import('@/lib/brain-transfer');
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(MAX_DECOMPRESSED_BYTES + 1024, 0x20)));
    const res = await POST(
      createRequest(`/api/brain/import?workspace_id=${WS1}`, {
        method: 'POST',
        rawBody: bomb,
        headers: { 'Content-Type': 'application/gzip' },
      }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('file_too_large');
    expect(fakeDb.rows('agent_memory')).toHaveLength(3);
  });

  it('refuses a read-only API key', async () => {
    const { authenticateApiKey } = await import('@/lib/api-key-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      keyId: 'k1',
      workspaceId: WS1,
      orgId: ORG,
      userId: USER,
      scopes: ['read'],
      environment: 'live',
      realtimeEnabled: false,
    });
    const { POST } = await import('@/app/api/brain/import/route');
    const res = await POST(
      createRequest('/api/brain/import', { method: 'POST', body: makeFile() }),
    );
    expect(res.status).toBe(403);
  });

  it('requires memory:delete for overwrite and memory:write for merge', async () => {
    const { POST } = await import('@/app/api/brain/import/route');
    granted.delete('memory:delete');
    try {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER } } });
      const overwrite = await POST(
        createRequest(`/api/brain/import?workspace_id=${WS1}&mode=overwrite`, {
          method: 'POST',
          body: makeFile(),
        }),
      );
      expect(overwrite.status).toBe(403);
      expect(fakeDb.rows('agent_memory')).toHaveLength(3);

      granted.delete('memory:write');
      const { authenticateApiKey } = await import('@/lib/api-key-auth');
      (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        keyId: 'k1',
        workspaceId: WS1,
        orgId: ORG,
        userId: USER,
        scopes: ['write'],
        environment: 'live',
        realtimeEnabled: false,
      });
      const merge = await POST(
        createRequest('/api/brain/import', { method: 'POST', body: makeFile() }),
      );
      expect(merge.status).toBe(403);
    } finally {
      granted.add('memory:write');
      granted.add('memory:delete');
    }
  });

  it('returns 401 without auth', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });
    const { POST } = await import('@/app/api/brain/import/route');
    const res = await POST(
      createRequest(`/api/brain/import?workspace_id=${WS1}`, { method: 'POST', body: makeFile() }),
    );
    expect(res.status).toBe(401);
  });
});
