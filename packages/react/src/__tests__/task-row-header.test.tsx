import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskRowHeader } from '../tasks/task-row-header';

// Mock @dnd-kit/core
vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: false,
  }),
}));

describe('TaskRowHeader', () => {
  const defaultProps = {
    status: 'inbox' as const,
    count: 5,
    overdueCount: 0,
    collapsed: false,
    onToggle: vi.fn(),
  };

  it('renders status label', () => {
    render(<TaskRowHeader {...defaultProps} />);
    expect(screen.getByText('Inbox')).toBeDefined();
  });

  it('renders task count', () => {
    render(<TaskRowHeader {...defaultProps} count={12} />);
    expect(screen.getByText('12')).toBeDefined();
  });

  it('renders overdue count when > 0 and not done', () => {
    render(<TaskRowHeader {...defaultProps} overdueCount={3} />);
    expect(screen.getByText('3 overdue')).toBeDefined();
  });

  it('does not render overdue for done status', () => {
    render(<TaskRowHeader {...defaultProps} status="done" overdueCount={3} />);
    expect(screen.queryByText('3 overdue')).toBeNull();
  });

  it('calls onToggle when header is clicked', () => {
    const onToggle = vi.fn();
    render(<TaskRowHeader {...defaultProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('Inbox'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('calls onAddTask when add button is clicked', () => {
    const onAddTask = vi.fn();
    render(<TaskRowHeader {...defaultProps} onAddTask={onAddTask} />);
    fireEvent.click(screen.getByTitle('Add task'));
    expect(onAddTask).toHaveBeenCalledWith('inbox');
  });

  it('renders custom header instead of default when provided', () => {
    render(<TaskRowHeader {...defaultProps} customHeader={<div>Custom Content</div>} />);
    expect(screen.getByText('Custom Content')).toBeDefined();
    expect(screen.queryByText('Inbox')).toBeNull();
  });

  it('applies green count style when count > 0', () => {
    const { container } = render(<TaskRowHeader {...defaultProps} count={5} />);
    const countEl = container.querySelector('.bg-\\(--celune-status-done\\)\\/10');
    expect(countEl).not.toBeNull();
  });

  it('applies muted count style when count is 0', () => {
    const { container } = render(<TaskRowHeader {...defaultProps} count={0} />);
    const countEl = container.querySelector('.bg-\\(--celune-surface-hover\\)');
    expect(countEl).not.toBeNull();
  });

  it('maps status labels correctly', () => {
    render(<TaskRowHeader {...defaultProps} status="scoping" />);
    expect(screen.getByText('Scoping')).toBeDefined();
  });

  it('maps planning status to Planned', () => {
    render(<TaskRowHeader {...defaultProps} status="planning" />);
    expect(screen.getByText('Planned')).toBeDefined();
  });
});
