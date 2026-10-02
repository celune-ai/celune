import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { NotFound, StoreError } from '../errors.ts';
import { createScope } from '../scope.ts';
import { SupabaseStore } from '../supabase/index.ts';

type Call = [method: string, ...args: unknown[]];

/** Records every builder call; the terminal call resolves to `result`. */
function mockClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of [
    'update',
    'select',
    'eq',
    'neq',
    'is',
    'range',
    'in',
    'lt',
    'order',
    'limit',
    'insert',
    'delete',
    'upsert',
  ]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = () => {
    calls.push(['maybeSingle']);
    return Promise.resolve(result);
  };
  builder.single = () => {
    calls.push(['single']);
    return Promise.resolve(result);
  };
  builder.then = (resolve: (value: typeof result) => unknown) => resolve(result);
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const scope = createScope({ workspaceId: 'ws-a', orgId: 'org-a', actorId: 'user-a' });
const eqs = (calls: Call[]) => calls.filter(([m]) => m === 'eq').map(([, col, val]) => [col, val]);

describe('SupabaseStore.jobs.claim', () => {
  it('filters by workspace, runner, and pending status for an API key', async () => {
    const { client, calls } = mockClient({ data: { id: 'j1' }, error: null });
    const row = await new SupabaseStore(client).jobs.claim(scope, 'j1', { keyId: 'key-1' });
    expect(row).toEqual({ id: 'j1' });
    expect(calls[0]).toEqual(['from', 'ai_job_queue']);
    expect(eqs(calls)).toEqual([
      ['id', 'j1'],
      ['workspace_id', 'ws-a'],
      ['runner', 'external'],
      ['status', 'pending'],
    ]);
  });

  it('claims server jobs only for a worker', async () => {
    const { client, calls } = mockClient({ data: null, error: null });
    await new SupabaseStore(client).jobs.claim(scope, 'j1', { workerId: 'worker-1' });
    expect(eqs(calls)).toContainEqual(['runner', 'server']);
  });

  it('throws database errors', async () => {
    // PostgREST returns plain objects; the store wraps them so hosts see an Error.
    const error = { message: 'connection reset', code: '08006' };
    const { client } = mockClient({ data: null, error });
    const thrown = await new SupabaseStore(client).jobs
      .claim(scope, 'j1', { keyId: 'key-1' })
      .catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(StoreError);
    expect(thrown).toMatchObject({ message: 'connection reset', code: '08006' });
  });
});

describe('SupabaseStore.jobs.heartbeat', () => {
  it('filters by workspace and claimant and throws database errors', async () => {
    const ok = mockClient({ data: { id: 'j1', status: 'streaming' }, error: null });
    await new SupabaseStore(ok.client).jobs.heartbeat(scope, 'j1', { keyId: 'key-1' }, {});
    expect(eqs(ok.calls)).toEqual([
      ['id', 'j1'],
      ['workspace_id', 'ws-a'],
      ['claimed_by_key_id', 'key-1'],
    ]);

    const error = { message: 'timeout' };
    const failing = mockClient({ data: null, error });
    await expect(
      new SupabaseStore(failing.client).jobs.heartbeat(scope, 'j1', { keyId: 'key-1' }, {}),
    ).rejects.toThrow(new StoreError('timeout'));
  });
});

describe('SupabaseStore.attachments', () => {
  it('scopes list through the task and strips the embedded task', async () => {
    const { client, calls } = mockClient({
      data: [{ id: 'a1', task_id: 't1', tasks: { workspace_id: 'ws-a' } }],
      error: null,
    });
    const rows = await new SupabaseStore(client).attachments.list(scope, 't1');
    expect(rows).toEqual([{ id: 'a1', task_id: 't1' }]);
    expect(String(calls.find(([m]) => m === 'select')?.[1])).toContain('tasks!inner(workspace_id)');
    expect(eqs(calls)).toEqual([
      ['task_id', 't1'],
      ['tasks.workspace_id', 'ws-a'],
    ]);
  });

  it('inserts only real columns, including user_id', async () => {
    const { client, calls } = mockClient({ data: { id: 'a1' }, error: null });
    const input = {
      task_id: 't1',
      file_name: 'a.png',
      file_size: 1,
      mime_type: 'image/png',
      storage_path: 't1/x_a.png',
      uploaded_by: 'user-a',
      user_id: 'user-a',
    };
    await new SupabaseStore(client).attachments.add(scope, input);
    expect(calls.find(([m]) => m === 'insert')?.[1]).toEqual(input);
  });

  it('removes by id and task after checking the task is in the scope', async () => {
    const { client, calls } = mockClient({ data: { id: 't1' }, error: null });
    await new SupabaseStore(client).attachments.remove(scope, 't1', 'a1');
    expect(calls.filter(([m]) => m === 'from')).toEqual([
      ['from', 'tasks'],
      ['from', 'task_attachments'],
    ]);
    expect(eqs(calls)).toEqual([
      ['id', 't1'],
      ['workspace_id', 'ws-a'],
      ['id', 'a1'],
      ['task_id', 't1'],
    ]);
  });

  it('refuses to add or remove for a task outside the scope', async () => {
    const { client, calls } = mockClient({ data: null, error: null });
    const store = new SupabaseStore(client);
    await expect(store.attachments.remove(scope, 't-other', 'a1')).rejects.toBeInstanceOf(NotFound);
    await expect(
      store.attachments.add(scope, {
        task_id: 't-other',
        file_name: 'a.png',
        file_size: 1,
        mime_type: 'image/png',
        storage_path: 't-other/a.png',
        uploaded_by: 'user-a',
        user_id: 'user-a',
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      store.comments.add(scope, { task_id: 't-other', author: 'a', content: 'c' }),
    ).rejects.toBeInstanceOf(NotFound);
    expect(calls.some(([m]) => m === 'insert' || m === 'delete')).toBe(false);
  });
});

describe('SupabaseStore.tasks.list', () => {
  it('filters active harness runs by harness name and open status', async () => {
    const { client, calls } = mockClient({ data: [], error: null });
    await new SupabaseStore(client).tasks.list(scope, { activeHarnessRun: 'headways' });
    expect(calls).toContainEqual(['eq', 'workspace_id', 'ws-a']);
    expect(calls).toContainEqual(['eq', 'metadata->harness_run->>harness', 'headways']);
    expect(calls).toContainEqual([
      'in',
      'metadata->harness_run->>status',
      ['queued', 'running', 'waiting'],
    ]);
  });
});

describe('SupabaseStore.harnessConnections', () => {
  const row = {
    harness: 'headways',
    agents: { rick: 'hw-rick' },
    config: { apiUrl: 'https://h.test' },
    created_by: 'user-a',
    updated_at: '2026-09-27T12:00:00Z',
  };

  it('reads only the scope workspace row', async () => {
    const { client, calls } = mockClient({ data: row, error: null });
    const got = await new SupabaseStore(client).harnessConnections.get(scope);
    expect(calls[0]).toEqual(['from', 'harness_connections']);
    expect(eqs(calls)).toEqual([['workspace_id', 'ws-a']]);
    expect(got).toEqual({
      harness: 'headways',
      agents: { rick: 'hw-rick' },
      config: { apiUrl: 'https://h.test' },
      createdBy: 'user-a',
      updatedAt: '2026-09-27T12:00:00Z',
    });
  });

  it('upserts with the scope workspace and org, keyed on workspace_id', async () => {
    const { client, calls } = mockClient({ data: row, error: null });
    await new SupabaseStore(client).harnessConnections.upsert(scope, {
      harness: 'headways',
      agents: { rick: 'hw-rick' },
      config: {},
      createdBy: 'user-a',
    });
    const upsert = calls.find(([m]) => m === 'upsert')!;
    expect(upsert[1]).toMatchObject({ workspace_id: 'ws-a', org_id: 'org-a', harness: 'headways' });
    expect(upsert[2]).toEqual({ onConflict: 'workspace_id' });
  });

  it('deletes only the scope workspace row', async () => {
    const { client, calls } = mockClient({ data: [{ workspace_id: 'ws-a' }], error: null });
    expect(await new SupabaseStore(client).harnessConnections.remove(scope)).toBe(true);
    expect(eqs(calls)).toEqual([['workspace_id', 'ws-a']]);
  });
});
