import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { TaskBoard, TaskListView, TaskDrawer } from '../tasks';
import { formatSyncAge } from '../tasks/task-states';
import { createMockTransport, makeTask } from '../testing';
import { renderWithCelune } from './utils';

const tasks = [makeTask({ title: 'Ship it', status: 'planning' })];

describe('loading', () => {
  it('shows skeleton columns in place of the board', () => {
    renderWithCelune(<TaskBoard initialTasks={[]} loading />);
    expect(screen.getByRole('status', { name: 'Loading tasks' })).toBeTruthy();
    expect(screen.queryByText('No tasks here yet.')).toBeNull();
  });

  it('shows skeleton rows in place of the list', () => {
    renderWithCelune(<TaskListView initialTasks={[]} loading />);
    expect(screen.getByRole('status', { name: 'Loading tasks' })).toBeTruthy();
  });

  it('shows the drawer skeleton while a task loads', () => {
    renderWithCelune(
      <TaskDrawer open loading task={null} onClose={() => undefined} onSaved={() => undefined} />,
    );
    expect(screen.getByRole('status', { name: 'Loading task' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close task drawer' })).toBeTruthy();
  });
});

describe('empty', () => {
  it('shows one sentence and a Create task action that opens the dialog', () => {
    renderWithCelune(<TaskBoard initialTasks={[]} />);
    expect(screen.getByText('No tasks here yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('drops the action when the viewer cannot edit', () => {
    renderWithCelune(<TaskListView initialTasks={[]} />, { canEdit: false });
    expect(screen.getByText('No tasks here yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create task' })).toBeNull();
  });
});

describe('polling stamp', () => {
  it('shows Updated Ns ago after a poll when realtime is absent', async () => {
    const transport = createMockTransport({ tasks });
    renderWithCelune(<TaskBoard initialTasks={tasks} />, { transport, pollInterval: 60_000 });
    expect(await screen.findByText('Updated 0s ago')).toBeTruthy();
  });

  it('stays hidden when a realtime adapter is present', async () => {
    const transport = createMockTransport({ tasks });
    renderWithCelune(<TaskBoard initialTasks={tasks} />, {
      transport,
      pollInterval: 60_000,
      subscribe: () => () => undefined,
    });
    await screen.findByText('Ship it');
    expect(screen.queryByText(/^Updated /)).toBeNull();
  });

  it('formats seconds, minutes, and hours', () => {
    expect(formatSyncAge(12)).toBe('Updated 12s ago');
    expect(formatSyncAge(125)).toBe('Updated 2m ago');
    expect(formatSyncAge(7200)).toBe('Updated 2h ago');
  });
});
