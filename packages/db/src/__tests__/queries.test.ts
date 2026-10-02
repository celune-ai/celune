import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getTasks,
  getTask,
  createTask,
  createProject,
  getProjects,
  getProject,
  verifyProjectTaskCompletion,
} from '../queries';

// ---------------------------------------------------------------------------
// Minimal Supabase query builder mock
// Supports chaining: .from().select().eq().order().limit().single() etc.
// ---------------------------------------------------------------------------

function makeQueryBuilder(resolvedValue: { data: unknown; error: unknown; count?: number }) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  builder.select = vi.fn(chain);
  builder.insert = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.delete = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.neq = vi.fn(chain);
  builder.is = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.not = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.limit = vi.fn(chain);
  builder.range = vi.fn(chain);
  builder.maybeSingle = vi.fn(() => Promise.resolve(resolvedValue));
  builder.single = vi.fn(() => Promise.resolve(resolvedValue));
  // Awaiting the builder itself resolves the query
  builder.then = (resolve: (value: unknown) => void) =>
    Promise.resolve(resolvedValue).then(resolve);

  return builder;
}

function makeSupabase(resolvedValue: { data: unknown; error: unknown; count?: number }) {
  const builder = makeQueryBuilder(resolvedValue);
  return {
    from: vi.fn(() => builder),
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const defaultScope = { workspace_id: 'ws-test-123' };

describe('getTasks', () => {
  it('returns an array of tasks on success', async () => {
    const tasks = [
      { id: '1', title: 'Task one', status: 'inbox' },
      { id: '2', title: 'Task two', status: 'in_progress' },
    ];
    const supabase = makeSupabase({ data: tasks, error: null });

    const result = await getTasks(supabase, { ...defaultScope });
    expect(result).toEqual(tasks);
    expect(supabase.from).toHaveBeenCalledWith('tasks');
  });

  it('throws when supabase returns an error', async () => {
    const supabase = makeSupabase({ data: null, error: new Error('DB error') });
    await expect(getTasks(supabase, { ...defaultScope })).rejects.toThrow('DB error');
  });

  it('passes status filter through the query chain', async () => {
    const supabase = makeSupabase({ data: [], error: null });
    await getTasks(supabase, { status: 'done', ...defaultScope });
    // The `from` call should have been made, chain methods are called on the builder
    expect(supabase.from).toHaveBeenCalledWith('tasks');
  });
});

describe('getTask', () => {
  it('returns a single task by id', async () => {
    const task = { id: 'task-123', title: 'Single task', status: 'inbox' };
    const supabase = makeSupabase({ data: task, error: null });

    const result = await getTask(supabase, 'task-123', 'ws-test-123');
    expect(result).toEqual(task);
    expect(supabase.from).toHaveBeenCalledWith('tasks');
  });

  it('throws when the task is not found', async () => {
    const supabase = makeSupabase({ data: null, error: new Error('Not found') });
    await expect(getTask(supabase, 'missing-id', 'ws-test-123')).rejects.toThrow('Not found');
  });
});

describe('createTask', () => {
  it('returns the created task', async () => {
    const created = { id: 'new-task', title: 'New task', status: 'inbox', sort_order: 1000 };

    // createTask makes two supabase calls: one to get max sort_order, one to insert.
    // We wire up a simple mock that returns the created task for both.
    const builder = makeQueryBuilder({ data: created, error: null });
    const supabase = {
      from: vi.fn(() => builder),
    } as unknown as SupabaseClient;

    const result = await createTask(supabase, { title: 'New task', workspace_id: 'ws-test-123' });
    expect(result).toEqual(created);
    expect(supabase.from).toHaveBeenCalledWith('tasks');
  });

  it('throws when insertion fails', async () => {
    const builder = makeQueryBuilder({ data: null, error: new Error('Insert failed') });
    const supabase = {
      from: vi.fn(() => builder),
    } as unknown as SupabaseClient;

    await expect(
      createTask(supabase, { title: 'Bad task', workspace_id: 'ws-test-123' }),
    ).rejects.toThrow('Insert failed');
  });

  it('throws when workspace_id is missing', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    const supabase = {
      from: vi.fn(() => builder),
    } as unknown as SupabaseClient;

    await expect(createTask(supabase, { title: 'No workspace' })).rejects.toThrow(
      'workspace_id is required when creating a task',
    );
  });
});

describe('createProject', () => {
  it('throws when workspace_id is missing', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    const supabase = {
      from: vi.fn(() => builder),
    } as unknown as SupabaseClient;

    await expect(createProject(supabase, { name: 'No workspace' })).rejects.toThrow(
      'workspace_id is required when creating a project',
    );
  });
});

describe('getProjects', () => {
  it('returns an array of projects', async () => {
    const projects = [
      { id: 'proj-1', name: 'Alpha', status: 'active' },
      { id: 'proj-2', name: 'Beta', status: 'active' },
    ];
    const supabase = makeSupabase({ data: projects, error: null });

    const result = await getProjects(supabase, { ...defaultScope });
    expect(result).toEqual(projects);
    expect(supabase.from).toHaveBeenCalledWith('projects');
  });

  it('throws when supabase returns an error', async () => {
    const supabase = makeSupabase({ data: null, error: new Error('Connection refused') });
    await expect(getProjects(supabase, { ...defaultScope })).rejects.toThrow('Connection refused');
  });
});

describe('getProject', () => {
  it('returns a single project by id', async () => {
    const project = { id: 'proj-1', name: 'Alpha', status: 'active' };
    const supabase = makeSupabase({ data: project, error: null });

    const result = await getProject(supabase, 'proj-1', 'ws-test-123');
    expect(result).toEqual(project);
    expect(supabase.from).toHaveBeenCalledWith('projects');
  });

  it('throws when the project is not found', async () => {
    const supabase = makeSupabase({ data: null, error: new Error('Not found') });
    await expect(getProject(supabase, 'nonexistent', 'ws-test-123')).rejects.toThrow('Not found');
  });
});

describe('verifyProjectTaskCompletion', () => {
  it('reports all done when all impl tasks are done', async () => {
    const tasks = [
      { id: 'prd-1', title: 'Create a PRD', status: 'done', metadata: { sprint: 0 } },
      { id: 'impl-1', title: 'Build feature A', status: 'done', metadata: { sprint: 1 } },
      { id: 'impl-2', title: 'Build feature B', status: 'done', metadata: { sprint: 2 } },
      { id: 'cr-1', title: 'Code review', status: 'inbox', metadata: { sprint: 99 } },
      { id: 'retro-1', title: 'Retro', status: 'inbox', metadata: { sprint: 99 } },
    ];
    const supabase = makeSupabase({ data: tasks, error: null });

    const report = await verifyProjectTaskCompletion(supabase, 'proj-1', 'ws-test-123');
    expect(report.allDone).toBe(true);
    expect(report.incomplete).toHaveLength(0);
    expect(report.complete).toHaveLength(2);
    expect(report.closing).toHaveLength(2);
    expect(report.summary).toContain('Ready for closing sequence');
  });

  it('reports incomplete when impl tasks are not done', async () => {
    const tasks = [
      { id: 'impl-1', title: 'Build feature A', status: 'done', metadata: { sprint: 1 } },
      { id: 'impl-2', title: 'Build feature B', status: 'inbox', metadata: { sprint: 2 } },
      { id: 'impl-3', title: 'Build feature C', status: 'in_progress', metadata: { sprint: 2 } },
      { id: 'cr-1', title: 'Code review', status: 'inbox', metadata: { sprint: 99 } },
    ];
    const supabase = makeSupabase({ data: tasks, error: null });

    const report = await verifyProjectTaskCompletion(supabase, 'proj-1', 'ws-test-123');
    expect(report.allDone).toBe(false);
    expect(report.incomplete).toHaveLength(2);
    expect(report.complete).toHaveLength(1);
    expect(report.summary).toContain('2 of 3');
  });

  it('skips PRD tasks (sprint 0)', async () => {
    const tasks = [
      { id: 'prd-1', title: 'Create a PRD', status: 'done', metadata: { sprint: 0 } },
      { id: 'impl-1', title: 'Build it', status: 'done', metadata: { sprint: 1 } },
    ];
    const supabase = makeSupabase({ data: tasks, error: null });

    const report = await verifyProjectTaskCompletion(supabase, 'proj-1', 'ws-test-123');
    expect(report.allDone).toBe(true);
    expect(report.complete).toHaveLength(1);
    // PRD is not in complete, incomplete, or closing
    expect(report.complete[0].id).toBe('impl-1');
  });

  it('handles tasks with null metadata', async () => {
    const tasks = [{ id: 'impl-1', title: 'Build it', status: 'done', metadata: null }];
    const supabase = makeSupabase({ data: tasks, error: null });

    const report = await verifyProjectTaskCompletion(supabase, 'proj-1', 'ws-test-123');
    expect(report.allDone).toBe(true);
    expect(report.complete).toHaveLength(1);
  });

  it('throws on supabase error', async () => {
    const supabase = makeSupabase({ data: null, error: new Error('DB down') });
    await expect(verifyProjectTaskCompletion(supabase, 'proj-1', 'ws-test-123')).rejects.toThrow(
      'DB down',
    );
  });
});
