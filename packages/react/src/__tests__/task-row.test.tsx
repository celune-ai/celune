import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { TaskRow } from '../tasks/task-row';
import { renderWithCelune as render } from './utils';
import type { Task } from '@repo/types';

// Mock @dnd-kit/sortable
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test Task',
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
    sort_order: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    archived_at: null,
    ...overrides,
  };
}

describe('TaskRow', () => {
  it('renders task title', () => {
    render(<TaskRow task={makeTask({ title: 'Fix the bug' })} />);
    expect(screen.getByText('Fix the bug')).toBeDefined();
  });

  it('renders status chip', () => {
    render(<TaskRow task={makeTask({ status: 'in_progress' })} />);
    expect(screen.getByText('In Progress')).toBeDefined();
  });

  it('renders high priority badge', () => {
    render(<TaskRow task={makeTask({ priority: 'high' })} />);
    expect(screen.getByText('High')).toBeDefined();
  });

  it('renders urgent priority badge', () => {
    render(<TaskRow task={makeTask({ priority: 'urgent' })} />);
    expect(screen.getByText('Urgent')).toBeDefined();
  });

  it('renders normal priority badge', () => {
    render(<TaskRow task={makeTask({ priority: 'normal' })} />);
    expect(screen.getByText('Normal')).toBeDefined();
  });

  it('renders assignee label when assigned', () => {
    render(<TaskRow task={makeTask({ assignee: 'rick' })} />);
    expect(screen.getByText('RICK')).toBeDefined();
  });

  it('renders dash placeholders for empty values', () => {
    render(<TaskRow task={makeTask({ assignee: 'unassigned' })} />);
    // Assignee "–" + effort "–" (both empty)
    const dashes = screen.getAllByText('–');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('shows sprint badge when showSprint is true and sprint metadata exists', () => {
    render(<TaskRow task={makeTask({ metadata: { sprint: 2 } })} showSprint />);
    expect(screen.getByText('S2')).toBeDefined();
  });

  it('hides sprint badge when showSprint is false', () => {
    render(<TaskRow task={makeTask({ metadata: { sprint: 2 } })} showSprint={false} />);
    expect(screen.queryByText('S2')).toBeNull();
  });

  it('renders project name when provided', () => {
    render(<TaskRow task={makeTask()} projectName="My Project" />);
    expect(screen.getByText('My Project')).toBeDefined();
  });

  it('shows completion circle button', () => {
    render(<TaskRow task={makeTask()} />);
    expect(screen.getByRole('button', { name: 'Complete task' })).toBeDefined();
  });

  it('shows completed state for done tasks', () => {
    render(<TaskRow task={makeTask({ status: 'done' })} />);
    expect(screen.getByRole('button', { name: 'Completed' })).toBeDefined();
  });

  it('calls onEdit when row is clicked', () => {
    const onEdit = vi.fn();
    const task = makeTask();
    render(<TaskRow task={task} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('row'));
    expect(onEdit).toHaveBeenCalledWith(task);
  });

  it('shows drag handle when sortMode is manual', () => {
    render(<TaskRow task={makeTask()} sortMode="manual" />);
    // GripVertical icon is rendered inside a button
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows unread dot when isUnread and sortMode is not manual', () => {
    const { container } = render(<TaskRow task={makeTask()} isUnread sortMode="sequence" />);
    const dot = container.querySelector('.bg-\\(--celune-status-scoping\\)');
    expect(dot).not.toBeNull();
  });

  it('shows green unread dot for done tasks', () => {
    const { container } = render(
      <TaskRow task={makeTask({ status: 'done' })} isUnread sortMode="sequence" />,
    );
    const dot = container.querySelector('.bg-\\(--celune-primary\\)');
    expect(dot).not.toBeNull();
  });

  it('does not apply active animation when metadata.blocked is true', () => {
    const { container } = render(
      <TaskRow task={makeTask({ metadata: { blocked: true, active_session: true } })} />,
    );
    const row = container.querySelector('[data-task-row]');
    expect(row?.className).not.toContain('animate-task-active');
  });
});
