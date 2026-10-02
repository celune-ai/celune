import { describe, it, expect } from 'vitest';
import { sortTasksForDisplay, countOverdue } from '../lib/task-sort';
import type { Task } from '@repo/types';

/** Minimal task factory — only fills fields needed by sort logic */
function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: overrides.id,
    description: null,
    outcome: null,
    status: 'in_progress',
    priority: 'normal',
    assignee: 'unassigned',
    project_id: null,
    user_id: null,
    org_id: null,
    workspace_id: null,
    category: [],
    due_date: null,
    source: null,
    source_ref: null,
    vault_path: null,
    time_estimate_minutes: null,
    time_spent_minutes: null,
    parent_id: null,
    spawned_by: null,
    context_keys: [],
    subtasks: null,
    metadata: null,
    depends_on: [],
    effort: null,
    success_criteria: null,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    archived_at: null,
    ...overrides,
  };
}

const TODAY = '2026-03-02';

/* ── Manual mode ─────────────────────────────────────── */

describe('sortTasksForDisplay — manual mode', () => {
  it('returns tasks in original order', () => {
    const tasks = [makeTask({ id: 'a', sort_order: 3 }), makeTask({ id: 'b', sort_order: 1 })];
    const result = sortTasksForDisplay(tasks, 'manual', TODAY);
    expect(result.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

/* ── Recency mode ────────────────────────────────────── */

describe('sortTasksForDisplay — recency mode', () => {
  it('sorts newest-first by created_at', () => {
    const tasks = [
      makeTask({ id: 'old', created_at: '2026-01-01T00:00:00Z' }),
      makeTask({ id: 'new', created_at: '2026-03-01T00:00:00Z' }),
      makeTask({ id: 'mid', created_at: '2026-02-01T00:00:00Z' }),
    ];
    const result = sortTasksForDisplay(tasks, 'recency', TODAY);
    expect(result.map((t) => t.id)).toEqual(['new', 'mid', 'old']);
  });

  it('does not mutate the input array', () => {
    const tasks = [
      makeTask({ id: 'a', created_at: '2026-03-01T00:00:00Z' }),
      makeTask({ id: 'b', created_at: '2026-01-01T00:00:00Z' }),
    ];
    const copy = [...tasks];
    sortTasksForDisplay(tasks, 'recency', TODAY);
    expect(tasks.map((t) => t.id)).toEqual(copy.map((t) => t.id));
  });
});

/* ── Priority mode ───────────────────────────────────── */

describe('sortTasksForDisplay — priority mode', () => {
  it('sorts by priority tier (urgent > high > normal > low)', () => {
    const tasks = [
      makeTask({ id: 'low', priority: 'low', sort_order: 0 }),
      makeTask({ id: 'urgent', priority: 'urgent', sort_order: 0 }),
      makeTask({ id: 'normal', priority: 'normal', sort_order: 0 }),
      makeTask({ id: 'high', priority: 'high', sort_order: 0 }),
    ];
    const result = sortTasksForDisplay(tasks, 'priority', TODAY);
    expect(result.map((t) => t.id)).toEqual(['urgent', 'high', 'normal', 'low']);
  });

  it('floats overdue tasks up within same priority', () => {
    const tasks = [
      makeTask({ id: 'future', priority: 'high', due_date: '2026-04-01', sort_order: 0 }),
      makeTask({ id: 'overdue', priority: 'high', due_date: '2026-02-01', sort_order: 1 }),
    ];
    const result = sortTasksForDisplay(tasks, 'priority', TODAY);
    expect(result.map((t) => t.id)).toEqual(['overdue', 'future']);
  });

  it('uses sort_order as tiebreaker within same priority and overdue status', () => {
    const tasks = [
      makeTask({ id: 'b', priority: 'normal', sort_order: 5 }),
      makeTask({ id: 'a', priority: 'normal', sort_order: 2 }),
    ];
    const result = sortTasksForDisplay(tasks, 'priority', TODAY);
    expect(result.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('treats null due_date as not overdue', () => {
    const tasks = [
      makeTask({ id: 'no-due', priority: 'high', due_date: null, sort_order: 0 }),
      makeTask({ id: 'overdue', priority: 'high', due_date: '2026-01-01', sort_order: 1 }),
    ];
    const result = sortTasksForDisplay(tasks, 'priority', TODAY);
    expect(result.map((t) => t.id)).toEqual(['overdue', 'no-due']);
  });
});

/* ── Sequence mode ───────────────────────────────────── */

describe('sortTasksForDisplay — sequence mode', () => {
  it('puts unblocking tasks (score 0) before non-unblocking (score 1)', () => {
    // task-b depends on task-a → task-a unblocks something → score 0
    const tasks = [
      makeTask({ id: 'b', depends_on: ['a'], sort_order: 0 }),
      makeTask({ id: 'a', depends_on: [], sort_order: 1 }),
    ];
    const result = sortTasksForDisplay(tasks, 'sequence', TODAY);
    // a = score 0 (no deps, unblocks b), b = score 3 (has incomplete dep a)
    expect(result[0]?.id).toBe('a');
  });

  it('puts tasks with all-done deps (score 2) before blocked tasks (score 3)', () => {
    const tasks = [
      makeTask({
        id: 'blocked',
        depends_on: ['undone'],
        metadata: { blocked: true },
        sort_order: 0,
      }),
      makeTask({ id: 'deps-done', depends_on: ['done-task'], sort_order: 1 }),
      makeTask({ id: 'done-task', status: 'done', sort_order: 2 }),
      makeTask({ id: 'undone', status: 'in_progress', sort_order: 3 }),
    ];
    const result = sortTasksForDisplay(tasks, 'sequence', TODAY);
    const ids = result.map((t) => t.id);
    expect(ids.indexOf('deps-done')).toBeLessThan(ids.indexOf('blocked'));
  });

  it('pins "Code review and QA" second-to-last and "Project retrospective" last', () => {
    const tasks = [
      makeTask({ id: 'retro', title: 'Project retrospective', sort_order: 0 }),
      makeTask({ id: 'review', title: 'Code review and QA', sort_order: 1 }),
      makeTask({ id: 'normal', title: 'Normal task', sort_order: 2 }),
    ];
    const result = sortTasksForDisplay(tasks, 'sequence', TODAY);
    const ids = result.map((t) => t.id);
    expect(ids[ids.length - 2]).toBe('review');
    expect(ids[ids.length - 1]).toBe('retro');
  });

  it('within same sequence score, sorts by priority', () => {
    const tasks = [
      makeTask({ id: 'low', priority: 'low', sort_order: 0 }),
      makeTask({ id: 'urgent', priority: 'urgent', sort_order: 1 }),
    ];
    const result = sortTasksForDisplay(tasks, 'sequence', TODAY);
    expect(result[0]?.id).toBe('urgent');
  });

  it('tasks with metadata.blocked=true get score 3', () => {
    const tasks = [
      makeTask({ id: 'blocked', metadata: { blocked: true }, sort_order: 0 }),
      makeTask({ id: 'free', sort_order: 1 }),
    ];
    const result = sortTasksForDisplay(tasks, 'sequence', TODAY);
    expect(result[0]?.id).toBe('free');
  });
});

/* ── countOverdue ────────────────────────────────────── */

describe('countOverdue', () => {
  it('counts tasks with due_date before today', () => {
    const tasks = [
      makeTask({ id: 'a', due_date: '2026-01-01' }),
      makeTask({ id: 'b', due_date: '2026-04-01' }),
      makeTask({ id: 'c', due_date: '2026-02-15' }),
      makeTask({ id: 'd', due_date: null }),
    ];
    expect(countOverdue(tasks, TODAY)).toBe(2);
  });

  it('returns 0 when no tasks are overdue', () => {
    const tasks = [makeTask({ id: 'a', due_date: '2026-04-01' })];
    expect(countOverdue(tasks, TODAY)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(countOverdue([], TODAY)).toBe(0);
  });
});
