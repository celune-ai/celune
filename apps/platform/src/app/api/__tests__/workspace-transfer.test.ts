// @vitest-environment node
/**
 * Workspace export/import tests: secret redaction, the zip bundle, round trip
 * between two workspaces with id remap, idempotent re-import, overwrite
 * scoping, version rejection, upload caps, the feature diff, and the
 * self-host to Cloud push.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, type Row } from './fake-supabase';

const fakeDb = new FakeDb();
const mockSupabase = { auth: { getUser: vi.fn() } };
const mockHost = vi.hoisted(() => ({
  hostConfig: {
    edition: 'community' as 'cloud' | 'community',
    productName: 'Acme PM',
    docsUrl: 'https://docs.example.test',
    cloudUrl: 'https://cloud.example.test',
    apiKeyPrefix: 'acme',
  },
}));

vi.mock('@repo/db/service', () => ({ createServiceClient: () => fakeDb }));
vi.mock('@repo/db/server', () => ({ createClient: () => Promise.resolve(mockSupabase) }));
vi.mock('@repo/db/validation', () => ({ isValidUuid: vi.fn(() => true) }));
vi.mock('@/lib/host-config', () => mockHost);
vi.mock('@/lib/csrf', () => ({ validateOrigin: vi.fn(async () => null) }));
vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(async () => ({ userId: USER_A })),
  resolvePermissions: vi.fn(async () => ({
    role: 'admin',
    permissions: new Set(['settings:manage']),
    isOwner: false,
    isPlatformOwner: false,
  })),
}));
vi.mock('@/lib/security-audit', () => ({ logPermissionDenied: vi.fn() }));
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_READ: { limit: 120, windowMs: 60000 },
  RATE_WRITE: { limit: 60, windowMs: 60000 },
  RATE_AUTH: { limit: 5, windowMs: 60000 },
}));
vi.mock('@/lib/require-workspace', () => ({
  requireWorkspaceMembership: vi.fn(async () => null),
}));
vi.mock('@/lib/api-key-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-key-auth')>()),
  authenticateApiKey: vi.fn(async () => null),
}));
vi.mock('@/lib/plan-enforcement', () => ({ enforcePlanLimit: vi.fn(async () => null) }));

const WS1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const WS2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const WS3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const USER_A = 'bbbbbbbb-0000-4000-8000-000000000001';
const USER_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const ORG = 'cccccccc-0000-4000-8000-000000000001';
const G1 = '10000000-0000-4000-8000-000000000001';
const P1 = '20000000-0000-4000-8000-000000000001';
const T1 = '30000000-0000-4000-8000-000000000001';
const T2 = '30000000-0000-4000-8000-000000000002';
const T3 = '30000000-0000-4000-8000-000000000003';
const T9 = '30000000-0000-4000-8000-000000000009';
const C1 = '40000000-0000-4000-8000-000000000001';
const A1 = '50000000-0000-4000-8000-000000000001';
const M1 = '60000000-0000-4000-8000-000000000001';
const R1 = '70000000-0000-4000-8000-000000000001';

const SECRETS = [
  'sk-live-provider-secret-1',
  'acme_live_workspacekey123456',
  'ghp_githubtoken0000000000',
  'hunter2-password',
  'webhook-secret-value',
  'ENCRYPTED-BLOB',
  'slack-bot-token-value',
];
const ATTACHMENT_BYTES = strToU8('# design notes\n');
const ts = '2026-09-01T00:00:00.000Z';

function seedSource() {
  fakeDb.seed('workspaces', [
    {
      id: WS1,
      org_id: ORG,
      name: 'Source',
      description: 'The source workspace',
      icon: 'rocket',
      color_scheme: 'violet',
      brain_settings: { tier: 'pro', webhook_url: 'webhook-secret-value' },
      metadata: { suspended_at: null, stripe_customer: 'cus_123' },
      github_settings: { token: 'ghp_githubtoken0000000000' },
      trial_token_budget: 50000,
    },
    { id: WS2, org_id: ORG, name: 'Target', description: null, icon: null, brain_settings: null },
    { id: WS3, org_id: ORG, name: 'Bystander' },
  ]);
  fakeDb.seed('provider_api_keys', [
    { id: 'pk1', workspace_id: WS1, provider: 'anthropic', encrypted_key: 'ENCRYPTED-BLOB' },
  ]);
  fakeDb.seed('project_groups', [
    { id: G1, workspace_id: WS1, user_id: USER_A, name: 'Epic', sort_order: 0, created_at: ts },
  ]);
  fakeDb.seed('projects', [
    {
      id: P1,
      workspace_id: WS1,
      user_id: USER_A,
      org_id: ORG,
      name: 'Launch',
      status: 'active',
      group_id: G1,
      project_type: 'feature',
      priority: 'normal',
      metadata: { owner: 'rick', api_key: 'sk-live-provider-secret-1' },
      prd_metadata: { author: 'noir' },
      sort_order: 0,
      created_at: ts,
      updated_at: ts,
    },
  ]);
  const task = (id: string, extra: Row = {}) => ({
    id,
    workspace_id: WS1,
    user_id: USER_A,
    org_id: ORG,
    title: `Task ${id.slice(-1)}`,
    status: 'inbox',
    priority: 'normal',
    assignee: 'rick',
    project_id: P1,
    category: ['code-quality'],
    context_keys: [],
    depends_on: [],
    sort_order: 0,
    created_at: ts,
    updated_at: ts,
    ...extra,
  });
  fakeDb.seed('tasks', [
    // Child listed before its parent to exercise the ordering.
    task(T2, { parent_id: T1, depends_on: [T1] }),
    task(T1, {
      metadata: {
        claimed_by: 'rick',
        slackBotToken: 'slack-bot-token-value',
        nested: { password: 'hunter2-password', key: 'acme_live_workspacekey123456' },
      },
      encrypted_payload: 'ENCRYPTED-BLOB',
      subtasks: [{ title: 'write tests', done: false }],
    }),
    task(T3, { depends_on: [T2, T9] }),
  ]);
  fakeDb.seed('tasks', [{ ...task(T9), workspace_id: WS3, project_id: null }]);
  fakeDb.seed('task_comments', [
    {
      id: C1,
      task_id: T1,
      workspace_id: WS1,
      user_id: USER_A,
      author: 'rick',
      content: 'Looks good',
      created_at: ts,
    },
  ]);
  fakeDb.seed('task_attachments', [
    {
      id: A1,
      task_id: T1,
      user_id: USER_A,
      file_name: 'notes.md',
      file_size: ATTACHMENT_BYTES.byteLength,
      mime_type: 'text/markdown',
      storage_path: `${T1}/abc_notes.md`,
      uploaded_by: 'rick',
      created_at: ts,
    },
  ]);
  fakeDb.objects.set(`task-attachments/${T1}/abc_notes.md`, ATTACHMENT_BYTES);
  fakeDb.seed('agent_configs', [
    {
      agent_id: 'rick',
      workspace_id: WS1,
      user_id: USER_A,
      parameters: { max_tokens: 4000, temperature: 0.2, apiKey: 'sk-live-provider-secret-1' },
      active_profile: 'default',
      model: 'claude-fable-5-1',
      display_name: 'RICK',
      is_active: true,
      contract_schema: { properties: { token: { type: 'string' } } },
    },
  ]);
  fakeDb.seed('agent_memory', [
    {
      id: M1,
      workspace_id: WS1,
      org_id: ORG,
      user_id: USER_A,
      key: 'launch-context',
      category: 'fact',
      content: 'Launch needs a pricing page',
      embedding: [0.1],
    },
  ]);
  fakeDb.seed('memory_relations', [
    {
      id: R1,
      workspace_id: WS1,
      memory_id: M1,
      related_type: 'task',
      related_id: T1,
      relation_type: 'context_for',
    },
  ]);
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

const rows = (table: string, ws: string) => fakeDb.rows(table).filter((r) => r.workspace_id === ws);

function snapshotSource() {
  const tables = [
    'project_groups',
    'projects',
    'tasks',
    'task_comments',
    'agent_configs',
    'agent_memory',
    'memory_relations',
  ];
  return JSON.parse(
    JSON.stringify({
      ...Object.fromEntries(tables.map((t) => [t, rows(t, WS1)])),
      workspace: fakeDb.rows('workspaces').find((w) => w.id === WS1),
      attachments: fakeDb.rows('task_attachments').filter((a) => a.task_id === T1),
    }),
  );
}

beforeAll(async () => {
  await import('@/app/api/workspace/export/route');
  await import('@/app/api/workspace/import/route');
  await import('@/app/api/workspace/migration/route');
  await import('@/app/api/workspace/migration/cloud/route');
}, 60_000);

beforeEach(() => {
  fakeDb.reset();
  vi.clearAllMocks();
  mockHost.hostConfig.edition = 'community';
  seedSource();
});

describe('scrubSecrets', () => {
  it('drops secret keys and key-shaped values and keeps ordinary fields', async () => {
    const { scrubSecrets } = await import('@/lib/workspace-transfer/format');
    expect(
      scrubSecrets({
        max_tokens: 10,
        tokens_used: 3,
        accessToken: 'x',
        refresh_token: 'y',
        apiKey: 'z',
        nested: [{ password: 'p', label: 'ok' }, 'sk-abc', 'plain'],
        encrypted_value: 'e',
      }),
    ).toEqual({ max_tokens: 10, tokens_used: 3, nested: [{ label: 'ok' }, 'plain'] });
  });

  it('drops provider keys, DSNs, bearer and auth fields under any naming style', async () => {
    const { scrubSecrets } = await import('@/lib/workspace-transfer/format');
    expect(
      scrubSecrets({
        openai_key: 'a',
        'Anthropic-Key': 'b',
        accessKeyId: 'c',
        'aws.secret_access_key': 'd',
        sentry_dsn: 'e',
        Bearer: 'f',
        auth: { user: 'u' },
        signing_key: 'g',
        client_secret: 'h',
        author: 'kept',
        max_tokens: 1,
      }),
    ).toEqual({ author: 'kept', max_tokens: 1 });
  });

  it('redacts keys inside free text and keeps schema keys in value-only columns', async () => {
    const { pickRow } = await import('@/lib/workspace-transfer/format');
    // Built at runtime so no key-shaped literal sits in the source.
    const githubLike = ['gh' + 'p', 'x'.repeat(20)].join('_');
    const providerLike = 'sk' + '-proj-' + 'y'.repeat(16);
    const row = pickRow(
      {
        description: `Use ${providerLike} and ${githubLike} for the deploy.`,
        contract_schema: {
          properties: { password: { type: 'string', default: providerLike } },
        },
      },
      ['description', 'contract_schema'],
    );
    expect(row.description).toBe('Use [redacted] and [redacted] for the deploy.');
    expect(row.contract_schema).toEqual({ properties: { password: { type: 'string' } } });
  });
});

describe('exportWorkspace', () => {
  it('never exports secret columns, secret keys, or other workspaces', async () => {
    const { exportWorkspace } = await import('@/lib/workspace-transfer/export');
    const { file } = await exportWorkspace(fakeDb as never, WS1, 'community');
    const text = JSON.stringify(file);

    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/encrypted|github_settings|stripe_customer|trial_token/);
    expect(text).not.toContain(T9);
    expect(text).not.toContain('storage_path');

    expect(file.settings).toEqual({
      name: 'Source',
      description: 'The source workspace',
      icon: 'rocket',
      color_scheme: 'violet',
      brain_settings: { tier: 'pro' },
    });
    expect(file.agent_configs[0]!.parameters).toEqual({ max_tokens: 4000, temperature: 0.2 });
    // Schemas are kept verbatim.
    expect(file.agent_configs[0]!.contract_schema).toEqual({
      properties: { token: { type: 'string' } },
    });
    expect(file.tasks.find((t) => t.id === T1)!.metadata).toEqual({
      claimed_by: 'rick',
      nested: {},
    });
    expect(file.counts).toMatchObject({ tasks: 3, task_attachments: 1, agent_memory: 1 });
    expect(file.brain!.agent_memory[0]).not.toHaveProperty('embedding');
  });

  it('bundles the export, a README, the env template, and attachment bytes', async () => {
    const { exportWorkspace } = await import('@/lib/workspace-transfer/export');
    const { buildWorkspaceZip } = await import('@/lib/workspace-transfer/archive');
    const exported = await exportWorkspace(fakeDb as never, WS1, 'cloud');
    const zip = await buildWorkspaceZip(fakeDb as never, exported, {
      productName: 'Acme PM',
      docsUrl: 'https://docs.example.test',
    });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      '.env.example',
      'README.md',
      `attachments/${A1}/notes.md`,
      'workspace.json',
    ]);
    const envTemplate = readFileSync(join(process.cwd(), '../../docker/.env.example'), 'utf8');
    expect(strFromU8(files['.env.example']!)).toBe(envTemplate);
    const readme = strFromU8(files['README.md']!);
    expect(readme).toContain('# Acme PM workspace export');
    expect(readme).toContain('workspace import');
    expect(readme).not.toMatch(/celune\.ai/);
    expect(strFromU8(files[`attachments/${A1}/notes.md`]!)).toBe('# design notes\n');
  });

  it('keeps the embedded env template in sync with docker/.env.example', async () => {
    const { DOCKER_ENV_EXAMPLE } = await import('@/lib/workspace-transfer/env-example.generated');
    const template = readFileSync(join(process.cwd(), '../../docker/.env.example'), 'utf8');
    // On failure run: node scripts/sync-docker-env-example.mjs
    expect(DOCKER_ENV_EXAMPLE).toBe(template);
  });
});

describe('importWorkspace round trip', () => {
  async function exportAndImport(mode: 'merge' | 'overwrite' = 'merge') {
    const { exportWorkspace } = await import('@/lib/workspace-transfer/export');
    const { buildWorkspaceZip, parseWorkspaceUpload } =
      await import('@/lib/workspace-transfer/archive');
    const { importWorkspace } = await import('@/lib/workspace-transfer/import');
    const exported = await exportWorkspace(fakeDb as never, WS1, 'cloud');
    const zip = await buildWorkspaceZip(fakeDb as never, exported, {
      productName: 'Acme PM',
      docsUrl: 'https://docs.example.test',
    });
    const upload = parseWorkspaceUpload(zip);
    return importWorkspace(
      fakeDb as never,
      { workspaceId: WS2, orgId: ORG, userId: USER_B },
      upload.file,
      mode,
      upload.attachments,
    );
  }

  it('recreates every table in the second workspace with remapped ids', async () => {
    const before = snapshotSource();
    const result = await exportAndImport();

    expect(result.counts).toEqual({
      project_groups: { inserted: 1, skipped: 0 },
      projects: { inserted: 1, skipped: 0 },
      tasks: { inserted: 3, skipped: 0 },
      task_comments: { inserted: 1, skipped: 0 },
      task_attachments: { inserted: 1, skipped: 0 },
      agent_configs: { inserted: 1, skipped: 0 },
    });
    expect(result.brain!.counts.agent_memory.inserted).toBe(1);
    expect(result.brain!.counts.memory_relations.inserted).toBe(1);
    expect(result.settings_applied.sort()).toEqual([
      'brain_settings',
      'color_scheme',
      'description',
      'icon',
    ]);

    const group = rows('project_groups', WS2)[0]!;
    const project = rows('projects', WS2)[0]!;
    const tasks = rows('tasks', WS2);
    expect(group.id).not.toBe(G1);
    expect(project.id).not.toBe(P1);
    expect(project.group_id).toBe(group.id);
    expect(project.user_id).toBe(USER_B);

    const byTitle = new Map(tasks.map((t) => [t.title as string, t]));
    const t1 = byTitle.get('Task 1')!;
    const t2 = byTitle.get('Task 2')!;
    const t3 = byTitle.get('Task 3')!;
    for (const t of tasks) {
      expect([T1, T2, T3]).not.toContain(t.id);
      expect(t.project_id).toBe(project.id);
    }
    expect(t2.parent_id).toBe(t1.id);
    expect(t2.depends_on).toEqual([t1.id]);
    // T9 lives in another workspace and did not come along.
    expect(t3.depends_on).toEqual([t2.id]);
    expect((t1.metadata as Row).imported_from).toBe(`${WS1}:${T1}`);

    const comment = rows('task_comments', WS2)[0]!;
    expect(comment.task_id).toBe(t1.id);

    const attachment = fakeDb.rows('task_attachments').find((a) => a.task_id === t1.id)!;
    expect(attachment.storage_path).toMatch(new RegExp(`^${t1.id}/.+_notes\\.md$`));
    expect(fakeDb.objects.get(`task-attachments/${attachment.storage_path}`)).toEqual(
      ATTACHMENT_BYTES,
    );

    expect(rows('agent_configs', WS2)[0]).toMatchObject({
      agent_id: 'rick',
      parameters: { max_tokens: 4000, temperature: 0.2 },
    });
    const relation = rows('memory_relations', WS2)[0]!;
    expect(relation.related_id).toBe(t1.id);

    expect(fakeDb.rows('workspaces').find((w) => w.id === WS2)).toMatchObject({
      name: 'Target',
      description: 'The source workspace',
      brain_settings: { tier: 'pro' },
    });

    // The source workspace is untouched.
    expect(snapshotSource()).toEqual(before);
    expect(fakeDb.objects.has(`task-attachments/${T1}/abc_notes.md`)).toBe(true);
  });

  it('skips everything on a second merge of the same export', async () => {
    await exportAndImport();
    const again = await exportAndImport();
    for (const counts of Object.values(again.counts)) expect(counts.inserted).toBe(0);
    expect(rows('tasks', WS2)).toHaveLength(3);
    expect(rows('task_comments', WS2)).toHaveLength(1);
    expect(fakeDb.rows('task_attachments')).toHaveLength(2);
  });

  it('overwrite deletes only rows in the target workspace', async () => {
    fakeDb.seed('tasks', [
      {
        id: '30000000-0000-4000-8000-0000000000aa',
        workspace_id: WS2,
        title: 'Old target task',
        depends_on: [],
      },
    ]);
    const result = await exportAndImport('overwrite');
    expect(result.deleted).toMatchObject({ tasks: 1 });
    expect(
      rows('tasks', WS2)
        .map((t) => t.title)
        .sort(),
    ).toEqual(['Task 1', 'Task 2', 'Task 3']);
    expect(rows('tasks', WS1)).toHaveLength(3);
    expect(rows('tasks', WS3)).toHaveLength(1);
  });

  it('overwrite leaves the target as it was when the import fails', async () => {
    const OLD = '30000000-0000-4000-8000-0000000000bb';
    fakeDb.seed('tasks', [
      { id: OLD, workspace_id: WS2, title: 'Old target task', depends_on: [] },
    ]);
    fakeDb.seed('task_comments', [
      {
        id: '40000000-0000-4000-8000-0000000000bb',
        workspace_id: WS2,
        task_id: OLD,
        content: 'kept',
      },
    ]);
    const objectsBefore = [...fakeDb.objects.keys()].sort();
    const from = fakeDb.from.bind(fakeDb);
    const spy = vi.spyOn(fakeDb, 'from').mockImplementation((table: string) => {
      const query = from(table);
      if (table === 'task_comments') {
        Object.assign(query, {
          insert: () => Promise.resolve({ data: null, error: { message: 'insert failed' } }),
        });
      }
      return query;
    });
    await expect(exportAndImport('overwrite')).rejects.toMatchObject({ message: 'insert failed' });
    spy.mockRestore();

    expect(rows('tasks', WS2).map((t) => t.id)).toEqual([OLD]);
    expect(rows('task_comments', WS2).map((c) => c.content)).toEqual(['kept']);
    expect(rows('projects', WS2)).toHaveLength(0);
    expect(rows('project_groups', WS2)).toHaveLength(0);
    expect(fakeDb.rows('task_attachments').every((a) => a.task_id === T1)).toBe(true);
    expect([...fakeDb.objects.keys()].sort()).toEqual(objectsBefore);
  });

  it('overwrite into the source workspace replaces its rows with fresh ids', async () => {
    const { exportWorkspace } = await import('@/lib/workspace-transfer/export');
    const { buildWorkspaceZip, parseWorkspaceUpload } =
      await import('@/lib/workspace-transfer/archive');
    const { importWorkspace } = await import('@/lib/workspace-transfer/import');
    const exported = await exportWorkspace(fakeDb as never, WS1, 'cloud');
    const zip = await buildWorkspaceZip(fakeDb as never, exported, {
      productName: 'Acme PM',
      docsUrl: 'https://docs.example.test',
    });
    const upload = parseWorkspaceUpload(zip);
    const result = await importWorkspace(
      fakeDb as never,
      { workspaceId: WS1, orgId: ORG, userId: USER_A },
      upload.file,
      'overwrite',
      upload.attachments,
    );
    expect(result.deleted).toMatchObject({ tasks: 3, projects: 1, project_groups: 1 });
    const tasks = rows('tasks', WS1);
    expect(tasks.map((t) => t.title).sort()).toEqual(['Task 1', 'Task 2', 'Task 3']);
    for (const t of tasks) expect([T1, T2, T3]).not.toContain(t.id);
    // The old attachment row and its file are gone; the re-imported one has its own file.
    expect(fakeDb.rows('task_attachments').some((a) => a.task_id === T1)).toBe(false);
    expect(fakeDb.objects.has(`task-attachments/${T1}/abc_notes.md`)).toBe(false);
    const attachment = fakeDb.rows('task_attachments')[0]!;
    expect(fakeDb.objects.get(`task-attachments/${attachment.storage_path}`)).toEqual(
      ATTACHMENT_BYTES,
    );
  });

  it('overwrite replaces agent configs and drops ones the file does not have', async () => {
    fakeDb.seed('agent_configs', [
      { agent_id: 'rick', workspace_id: WS2, parameters: { max_tokens: 1 } },
      { agent_id: 'old-agent', workspace_id: WS2, parameters: {} },
    ]);
    const result = await exportAndImport('overwrite');
    expect(result.deleted).toMatchObject({ agent_configs: 1 });
    const agents = rows('agent_configs', WS2);
    expect(agents.map((a) => a.agent_id)).toEqual(['rick']);
    expect(agents[0]!.parameters).toEqual({ max_tokens: 4000, temperature: 0.2 });
  });

  it('skips attachments whose bytes are missing and reports them', async () => {
    const { exportWorkspace } = await import('@/lib/workspace-transfer/export');
    const { parseWorkspaceFile } = await import('@/lib/workspace-transfer/format');
    const { importWorkspace } = await import('@/lib/workspace-transfer/import');
    const { file } = await exportWorkspace(fakeDb as never, WS1, 'cloud');
    const result = await importWorkspace(
      fakeDb as never,
      { workspaceId: WS2, orgId: ORG, userId: USER_B },
      parseWorkspaceFile(JSON.parse(JSON.stringify(file))),
      'merge',
    );
    expect(result.attachments_without_bytes).toBe(1);
    expect(result.counts.task_attachments).toEqual({ inserted: 0, skipped: 1 });
  });
});

describe('version and upload checks', () => {
  const base = { format: 'celune-workspace', format_version: 1 };

  it('rejects a newer workspace version, a wrong format, and a newer nested brain', async () => {
    const { parseWorkspaceFile } = await import('@/lib/workspace-transfer/format');
    expect(() => parseWorkspaceFile({ ...base, format_version: 2 })).toThrowError(
      /Unsupported workspace export format_version 2/,
    );
    expect(() => parseWorkspaceFile({ format: 'celune-brain', format_version: 1 })).toThrowError(
      /Expected format "celune-workspace"/,
    );
    expect(() =>
      parseWorkspaceFile({ ...base, brain: { format: 'celune-brain', format_version: 99 } }),
    ).toThrowError(/Unsupported brain export format_version 99/);
    expect(() => parseWorkspaceFile({ ...base, tasks: [{ id: 'nope', title: 'x' }] })).toThrowError(
      /at tasks\.0\.id/,
    );
    expect(parseWorkspaceFile(base).tasks).toEqual([]);
  });

  it('reads gzip and rejects oversized bodies and zips without the document', async () => {
    const { parseWorkspaceUpload, readCapped } = await import('@/lib/workspace-transfer/archive');
    expect(parseWorkspaceUpload(gzipSync(JSON.stringify(base))).file.format_version).toBe(1);
    expect(() => parseWorkspaceUpload(zipSync({ 'README.md': strToU8('hi') }))).toThrowError(
      /no workspace\.json/,
    );
    const body = new Response(new Uint8Array(64)).body;
    await expect(readCapped(body, 32)).rejects.toMatchObject({
      code: 'file_too_large',
      status: 413,
    });
  });

  it('answers a version mismatch on the import route with 400', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER_B } } });
    const { POST } = await import('@/app/api/workspace/import/route');
    const res = await POST(
      createRequest(`/api/workspace/import?workspace_id=${WS2}`, {
        method: 'POST',
        body: { ...base, format_version: 7 },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'unsupported_format_version' });
    expect(rows('tasks', WS2)).toHaveLength(0);
  });
});

describe('workspace routes', () => {
  it('exports a zip through the route', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER_A } } });
    const { GET } = await import('@/app/api/workspace/export/route');
    const res = await GET(createRequest(`/api/workspace/export?workspace_id=${WS1}&format=zip`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(JSON.parse(strFromU8(files['workspace.json']!)).source).toEqual({
      workspace_id: WS1,
      edition: 'community',
    });
  });

  it('requires settings:manage for session callers', async () => {
    const { resolvePermissions } = await import('@/lib/permissions');
    vi.mocked(resolvePermissions).mockResolvedValueOnce({
      role: 'member',
      permissions: new Set(),
      isOwner: false,
      isPlatformOwner: false,
    } as never);
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER_A } } });
    const { GET } = await import('@/app/api/workspace/export/route');
    const res = await GET(createRequest(`/api/workspace/export?workspace_id=${WS1}`));
    expect(res.status).toBe(403);
  });

  it('describes the feature diff from the gates', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER_A } } });
    const { GET } = await import('@/app/api/workspace/migration/route');
    const res = await GET(createRequest(`/api/workspace/migration?workspace_id=${WS1}`));
    const body = await res.json();
    expect(body).toMatchObject({
      edition: 'community',
      target_edition: 'cloud',
      can_move_to_cloud: true,
      cloud_url: 'https://cloud.example.test',
    });
    const byFeature = Object.fromEntries(
      (body.feature_diff as Row[]).map((r) => [r.feature, r.change]),
    );
    // Cloud's paywall covers every feature, so the move adds a limit to all of them.
    expect(byFeature).toMatchObject({
      'workspace.access': 'adds_limit',
      'task.create': 'adds_limit',
      'api_key.create': 'adds_limit',
      'agent.run': 'adds_limit',
      'provider.fallback_key': 'adds_limit',
    });
  });

  it('reverses the diff for a Cloud to self-host move', async () => {
    const { featureDiff } = await import('@/lib/workspace-transfer/migration');
    const diff = featureDiff('cloud', 'community');
    expect(diff.find((r) => r.feature === 'project.create')).toMatchObject({
      current: 'plan_limited',
      target: 'open',
      change: 'removes_limit',
    });
  });
});

describe('POST /api/workspace/migration/cloud', () => {
  const KEY = 'acme_live_cloudkey000000000000';

  it('uploads to the configured Cloud URL with the pasted key and keeps the source', async () => {
    const { parseWorkspaceUpload } = await import('@/lib/workspace-transfer/archive');
    const { importWorkspace } = await import('@/lib/workspace-transfer/import');
    // The stub plays the Cloud instance: it imports into WS2 of the same fake database.
    const cloudFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const upload = parseWorkspaceUpload(init.body as Uint8Array);
      const result = await importWorkspace(
        fakeDb as never,
        { workspaceId: WS2, orgId: ORG, userId: USER_B },
        upload.file,
        'merge',
        upload.attachments,
      );
      return new Response(JSON.stringify(result), { status: 200 });
    });
    vi.stubGlobal('fetch', cloudFetch);
    try {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER_A } } });
      const { POST } = await import('@/app/api/workspace/migration/cloud/route');
      const res = await POST(
        createRequest(`/api/workspace/migration/cloud?workspace_id=${WS1}`, {
          method: 'POST',
          body: { api_key: KEY },
        }),
      );
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(text).not.toContain(KEY);

      const [url, init] = cloudFetch.mock.calls[0]!;
      expect(url).toBe('https://cloud.example.test/api/workspace/import?mode=merge');
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
      expect(JSON.parse(text).imported.counts.tasks.inserted).toBe(3);
      expect(rows('tasks', WS1)).toHaveLength(3);
      expect(rows('tasks', WS2)).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not follow a redirect from the Cloud URL', async () => {
    const cloudFetch = vi.fn(
      async () =>
        new Response(null, { status: 307, headers: { location: 'https://elsewhere.test/' } }),
    );
    vi.stubGlobal('fetch', cloudFetch);
    try {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER_A } } });
      const { POST } = await import('@/app/api/workspace/migration/cloud/route');
      const res = await POST(
        createRequest(`/api/workspace/migration/cloud?workspace_id=${WS1}`, {
          method: 'POST',
          body: { api_key: KEY },
        }),
      );
      expect(res.status).toBe(502);
      expect(await res.text()).toContain('redirect');
      expect(cloudFetch).toHaveBeenCalledTimes(1);
      expect((cloudFetch.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe(
        'manual',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('passes Cloud auth failures through without echoing the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 }),
      ),
    );
    try {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER_A } } });
      const { POST } = await import('@/app/api/workspace/migration/cloud/route');
      const res = await POST(
        createRequest(`/api/workspace/migration/cloud?workspace_id=${WS1}`, {
          method: 'POST',
          body: { api_key: KEY },
        }),
      );
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toContain('Invalid API key');
      expect(text).not.toContain(KEY);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is refused on the Cloud edition and for a missing key', async () => {
    const { POST } = await import('@/app/api/workspace/migration/cloud/route');
    mockHost.hostConfig.edition = 'cloud';
    const refused = await POST(
      createRequest(`/api/workspace/migration/cloud?workspace_id=${WS1}`, {
        method: 'POST',
        body: { api_key: KEY },
      }),
    );
    expect(refused.status).toBe(403);

    mockHost.hostConfig.edition = 'community';
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER_A } } });
    const missing = await POST(
      createRequest(`/api/workspace/migration/cloud?workspace_id=${WS1}`, {
        method: 'POST',
        body: {},
      }),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: 'invalid_api_key' });
  });
});
