import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ActivityItem } from '../activity-item';
import type { ActivityEntry } from '@repo/types';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock next/navigation for useParams (used by useWorkspaceHref)
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspace: 'main' }),
}));

// Mock date-utils to return a stable relative time
vi.mock('@/lib/date-utils', () => ({
  formatRelativeTime: () => '2 hours ago',
}));

function makeActivity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'act-1',
    event_type: 'task.created',
    severity: 'info',
    source: 'web',
    title: 'Task created: Setup CI',
    details: null,
    task_id: null,
    agent_id: null,
    user_id: null,
    actor_user_id: null,
    workspace_id: null,
    created_at: '2026-01-01T12:00:00Z',
    acknowledged_at: null,
    ...overrides,
  };
}

describe('ActivityItem', () => {
  it('renders activity title', () => {
    render(<ActivityItem entry={makeActivity({ title: 'New deployment' })} />);

    expect(screen.getByText('New deployment')).toBeDefined();
  });

  it('renders event type badge', () => {
    render(<ActivityItem entry={makeActivity({ event_type: 'task.completed' })} />);

    expect(screen.getByText('task.completed')).toBeDefined();
  });

  it('renders source when provided', () => {
    render(<ActivityItem entry={makeActivity({ source: 'agent-cli' })} />);

    expect(screen.getByText('agent-cli')).toBeDefined();
  });

  it('renders relative time', () => {
    render(<ActivityItem entry={makeActivity()} />);

    expect(screen.getByText('2 hours ago')).toBeDefined();
  });

  it('wraps in a link when task_id is present', () => {
    const { container } = render(<ActivityItem entry={makeActivity({ task_id: 'task-123' })} />);

    const link = container.querySelector('a[href="/main/tasks?id=task-123"]');
    expect(link).not.toBeNull();
  });

  it('renders as div when task_id is null', () => {
    const { container } = render(<ActivityItem entry={makeActivity({ task_id: null })} />);

    const link = container.querySelector('a');
    expect(link).toBeNull();
  });

  it('renders info severity with blue icon', () => {
    const { container } = render(<ActivityItem entry={makeActivity({ severity: 'info' })} />);

    const icon = container.querySelector('.text-blue-500');
    expect(icon).not.toBeNull();
  });

  it('renders warning severity with yellow icon', () => {
    const { container } = render(<ActivityItem entry={makeActivity({ severity: 'warning' })} />);

    const icon = container.querySelector('.text-yellow-500');
    expect(icon).not.toBeNull();
  });

  it('renders error severity with red icon', () => {
    const { container } = render(<ActivityItem entry={makeActivity({ severity: 'error' })} />);

    const icon = container.querySelector('.text-red-500');
    expect(icon).not.toBeNull();
  });
});
