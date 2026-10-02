'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import type { ActivityEntry, Project, Task, TaskComment } from '@repo/types';
import { CeluneProvider, type CeluneProviderProps } from '../provider/celune-provider';
import { CeluneTransportError, type CeluneTransport } from '../transport/types';

export interface MockSeed {
  tasks?: Task[];
  projects?: Project[];
  comments?: TaskComment[];
  activity?: ActivityEntry[];
}

let counter = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: nextId(),
    title: 'Untitled task',
    description: null,
    outcome: null,
    status: 'inbox',
    priority: 'normal',
    assignee: 'unassigned',
    project_id: null,
    user_id: null,
    org_id: null,
    workspace_id: 'ws-demo',
    category: [],
    due_date: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    sort_order: 0,
    depends_on: [],
    ...overrides,
  } as Task;
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return {
    id: nextId(),
    name: 'Untitled project',
    description: null,
    status: 'active',
    priority: 'normal',
    project_type: 'feature',
    created_at: now,
    updated_at: now,
    sort_order: 0,
    ...overrides,
  } as Project;
}

export interface MockTransport extends CeluneTransport {
  /** Current in-memory rows, for assertions. */
  readonly db: { tasks: Task[]; projects: Project[]; comments: TaskComment[] };
  /** Makes the next N calls fail with the given status. */
  failNext(status: number, times?: number): void;
  calls: string[];
}

/** In-memory transport for tests, stories, and demos. Implements every operation. */
export function createMockTransport(
  seed: MockSeed = {},
  options: { latency?: number } = {},
): MockTransport {
  const db = {
    tasks: [...(seed.tasks ?? [])],
    projects: [...(seed.projects ?? [])],
    comments: [...(seed.comments ?? [])],
  };
  const activity = [...(seed.activity ?? [])];
  const calls: string[] = [];
  let failures: { status: number; left: number } | null = null;

  const run = async <T,>(name: string, fn: () => T): Promise<T> => {
    calls.push(name);
    if (options.latency) await new Promise((r) => setTimeout(r, options.latency));
    if (failures && failures.left > 0) {
      failures.left -= 1;
      throw new CeluneTransportError(failures.status, { error: 'Mock failure' });
    }
    return fn();
  };
  const find = (id: string) => {
    const task = db.tasks.find((t) => t.id === id);
    if (!task) throw new CeluneTransportError(404, { error: 'Resource not found' });
    return task;
  };

  return {
    db,
    calls,
    failNext(status, times = 1) {
      failures = { status, left: times };
    },
    tasks: {
      list: (p = {}) =>
        run('tasks.list', () =>
          db.tasks
            .filter(
              (t) =>
                (!p.projectId || t.project_id === p.projectId) &&
                (!p.status || t.status === p.status),
            )
            .slice(p.offset ?? 0, (p.offset ?? 0) + (p.pageSize ?? 500))
            .map((t) => ({ ...t })),
        ),
      count: (p = {}) =>
        run(
          'tasks.count',
          () => db.tasks.filter((t) => !p.projectId || t.project_id === p.projectId).length,
        ),
      get: (id) => run('tasks.get', () => ({ ...find(id) })),
      create: (input) =>
        run('tasks.create', () => {
          const task = makeTask(input as Partial<Task>);
          db.tasks.push(task);
          return task;
        }),
      update: (id, patch) =>
        run('tasks.update', () => {
          const task = find(id);
          Object.assign(task, patch, { updated_at: new Date().toISOString() });
          return { ...task };
        }),
      remove: (id) =>
        run('tasks.remove', () => {
          db.tasks = db.tasks.filter((t) => t.id !== id);
        }),
      reorder: (items) =>
        run('tasks.reorder', () => {
          for (const item of items) {
            const task = find(item.id);
            task.sort_order = item.sort_order;
            if (item.status) task.status = item.status as Task['status'];
          }
        }),
      dependencies: (id) =>
        run('tasks.dependencies', () =>
          (find(id).depends_on ?? []).flatMap((dep) => db.tasks.find((t) => t.id === dep) ?? []),
        ),
      children: (id) =>
        run('tasks.children', () => {
          const children = db.tasks.filter((t) => t.parent_id === id);
          return { children, allComplete: children.every((c) => c.status === 'done') };
        }),
      spawned: (id) => run('tasks.spawned', () => db.tasks.filter((t) => t.spawned_by === id)),
      context: () => run('tasks.context', () => []),
      usage: () => run('tasks.usage', () => ({ hasUsage: false })),
    },
    comments: {
      list: (taskId) => run('comments.list', () => db.comments.filter((c) => c.task_id === taskId)),
      create: (taskId, input) =>
        run('comments.create', () => {
          const comment = {
            id: nextId(),
            task_id: taskId,
            author: input.author ?? 'user',
            content: input.content,
            created_at: new Date().toISOString(),
          } as TaskComment;
          db.comments.push(comment);
          return comment;
        }),
    },
    activity: {
      list: ({ taskId, limit }) =>
        run('activity.list', () => activity.filter((a) => a.task_id === taskId).slice(0, limit)),
    },
    projects: {
      list: () => run('projects.list', () => db.projects.map((p) => ({ ...p }))),
      reorder: (items) =>
        run('projects.reorder', () => {
          for (const item of items) {
            const project = db.projects.find((p) => p.id === item.id);
            if (project) project.sort_order = item.sort_order;
          }
        }),
      progressLog: () => run('projects.progressLog', () => []),
    },
  };
}

export interface CeluneTestProviderProps extends Partial<Omit<CeluneProviderProps, 'children'>> {
  children: ReactNode;
}

/** CeluneProvider preset for tests and stories: mock transport, polling off, fresh query cache. */
export function CeluneTestProvider({
  children,
  transport,
  queryClient,
  ...props
}: CeluneTestProviderProps) {
  const [ownTransport] = useState(() => createMockTransport());
  const [ownClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <CeluneProvider
      apiUrl="http://celune.test/v1"
      token="test-token"
      workspaceId="ws-demo"
      pollInterval={0}
      currentUser={TEST_USER}
      {...props}
      transport={transport ?? ownTransport}
      queryClient={queryClient ?? ownClient}
    >
      {children}
    </CeluneProvider>
  );
}

const TEST_USER = { displayName: 'Tester', assignee: 'eric' };
