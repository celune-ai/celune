import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TaskCardSkeleton } from '../tasks/task-card-skeleton';
import type { Task } from '@repo/types';

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: 'Test task',
    description: null,
    outcome: null,
    status: 'inbox',
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

describe('TaskCardSkeleton', () => {
  it('renders loading indicator in generating phase', () => {
    const { container } = render(<TaskCardSkeleton phase="generating" />);

    // Should have animate-spin loader
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });

  it('renders check icon in success phase', () => {
    const { container } = render(<TaskCardSkeleton phase="success" />);

    const check = container.querySelector('.text-\\(--celune-status-done\\)');
    expect(check).not.toBeNull();
  });

  it('renders task title in reveal phase', () => {
    const task = makeTask({ id: '1', title: 'Setup CI pipeline' });

    render(<TaskCardSkeleton phase="reveal" task={task} />);

    expect(screen.getByText('Setup CI pipeline')).toBeDefined();
  });

  it('renders project name in reveal phase', () => {
    const task = makeTask({ id: '1', title: 'Test' });

    render(<TaskCardSkeleton phase="reveal" task={task} projectName="Platform v2" />);

    expect(screen.getByText('Platform v2')).toBeDefined();
  });

  it('calls onTransitionEnd after reveal phase timeout', () => {
    vi.useFakeTimers();
    const onTransitionEnd = vi.fn();
    const task = makeTask({ id: '1', title: 'Test' });

    render(<TaskCardSkeleton phase="reveal" task={task} onTransitionEnd={onTransitionEnd} />);

    expect(onTransitionEnd).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(onTransitionEnd).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not call onTransitionEnd in generating phase', () => {
    vi.useFakeTimers();
    const onTransitionEnd = vi.fn();

    render(<TaskCardSkeleton phase="generating" onTransitionEnd={onTransitionEnd} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onTransitionEnd).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('shows pulse skeleton bars in generating phase', () => {
    const { container } = render(<TaskCardSkeleton phase="generating" />);

    const pulseBars = container.querySelectorAll('.animate-pulse');
    expect(pulseBars.length).toBeGreaterThan(0);
  });

  it('stops the pulse when the user prefers reduced motion', () => {
    const { container } = render(<TaskCardSkeleton phase="generating" />);

    for (const bar of container.querySelectorAll('.animate-pulse')) {
      expect(bar.classList).toContain('motion-reduce:animate-none');
    }
  });
});
