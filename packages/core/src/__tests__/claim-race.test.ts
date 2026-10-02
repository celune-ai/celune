import type { SupabaseClient } from '@supabase/supabase-js';
import type { Task } from '@repo/types';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../actor.ts';
import { Conflict } from '../errors.ts';
import { createScope } from '../scope.ts';
import type { Store, TaskStore } from '../store.ts';
import { SupabaseStore } from '../supabase/index.ts';
import { TaskService } from '../tasks/task-service.ts';
import { InMemoryStore } from '../testing/memory-store.ts';

const scope = createScope({ workspaceId: 'ws-a', orgId: 'org-a', actorId: 'user-a' });
const cli: ActorContext = { source: 'task-cli', ownerUserId: 'owner-1' };
const clock = () => new Date('2026-09-27T12:00:00.000Z');

/** Holds every tasks.get until `readers` calls have read, so both claims read before either writes. */
function holdReads(tasks: TaskStore, readers: number): void {
  const get = tasks.get;
  let arrived = 0;
  let release!: () => void;
  const allRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  tasks.get = async (s, id) => {
    const row = await get(s, id);
    arrived += 1;
    if (arrived === readers) release();
    await allRead;
    return row;
  };
}

async function race(service: TaskService, taskId: string) {
  const results = await Promise.allSettled([
    service.claim(scope, taskId, 'rick', cli),
    service.claim(scope, taskId, 'nova', cli),
  ]);
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  return { won, lost };
}

describe('TaskService.claim under concurrent claims', () => {
  it('lets one of two interleaved claims win in the memory store', async () => {
    const store = new InMemoryStore({ clock });
    const task = store.seedTask(scope, { title: 't', status: 'planning' });
    holdReads(store.tasks, 2);

    const { won, lost } = await race(new TaskService(store, { clock }), task.id);

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]?.reason).toBeInstanceOf(Conflict);
    const winner = (won[0] as PromiseFulfilledResult<Task>).value;
    expect(store.taskRows.get(task.id)?.assignee).toBe(winner.assignee);
    expect(store.activityRows.filter((a) => a.event_type === 'task.claimed')).toHaveLength(1);
  });

  it('lets one of two interleaved claims win when both start from the inbox', async () => {
    const store = new InMemoryStore({ clock });
    const task = store.seedTask(scope, { title: 't', status: 'inbox' });
    holdReads(store.tasks, 2);

    const { won, lost } = await race(new TaskService(store, { clock }), task.id);

    expect(won).toHaveLength(1);
    expect(lost[0]?.reason).toBeInstanceOf(Conflict);
    expect(store.taskRows.get(task.id)?.status).toBe('in_progress');
  });

  it('lets one of two interleaved claims win through the Supabase adapter', async () => {
    const mem = new InMemoryStore({ clock });
    const row = { ...mem.seedTask(scope, { title: 't', status: 'planning' }) };
    const { client, writes } = fakeTasksTable(row);
    const tasks = new SupabaseStore(client).tasks;
    holdReads(tasks, 2);
    const store: Store = {
      tasks,
      projects: mem.projects,
      comments: mem.comments,
      attachments: mem.attachments,
      activity: mem.activity,
      agents: mem.agents,
      jobs: mem.jobs,
      transaction: (fn) => fn(store),
    };

    const { won, lost } = await race(new TaskService(store, { clock }), row.id);

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]?.reason).toBeInstanceOf(Conflict);
    expect(writes).toEqual([
      { status: 'planning', applied: true },
      { status: 'planning', applied: false },
    ]);
    expect(row.assignee).toBe((won[0] as PromiseFulfilledResult<Task>).value.assignee);
  });
});

/**
 * A one-row tasks table behind a PostgREST-shaped builder. Reads and updates apply every
 * eq() filter, so a conditional update that no longer matches returns no row, as Postgres does.
 */
function fakeTasksTable(row: Task) {
  const writes: { status: unknown; applied: boolean }[] = [];
  const client = {
    from: (table: string) => {
      if (table !== 'tasks') throw new Error(`unexpected table ${table}`);
      const filters: [string, unknown][] = [];
      let patch: Partial<Task> | null = null;
      const matches = () =>
        filters.every(([col, val]) => (row as unknown as Record<string, unknown>)[col] === val);
      const run = () => {
        if (!matches()) {
          if (patch) {
            writes.push({ status: filters.find(([c]) => c === 'status')?.[1], applied: false });
          }
          return null;
        }
        if (patch) {
          Object.assign(row, patch);
          writes.push({ status: filters.find(([c]) => c === 'status')?.[1], applied: true });
        }
        return { ...row };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (p: Partial<Task>) => {
          patch = p;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        single: async () => {
          const data = run();
          return data
            ? { data, error: null }
            : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        },
        maybeSingle: async () => ({ data: run(), error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, writes };
}
