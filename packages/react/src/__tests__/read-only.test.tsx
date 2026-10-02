import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { TaskCard } from '../tasks/task-card';
import { TaskColumn } from '../tasks/task-column';
import { TaskRow } from '../tasks/task-row';
import { createMockTransport, makeTask } from '../testing';
import { renderWithCelune as render } from './utils';

describe('read-only mode', () => {
  it('card does not complete, assign, or reschedule', () => {
    const transport = createMockTransport();
    const update = vi.spyOn(transport.tasks, 'update');
    render(
      <DndContext>
        <TaskCard task={makeTask({ assignee: 'unassigned' })} />
      </DndContext>,
      { canEdit: false, transport },
    );

    const complete = screen.getByRole('button', { name: 'Complete task' });
    expect(complete).toBeDisabled();
    fireEvent.click(complete);
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByText('Add due date')).toBeNull();
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-haspopup'))).toEqual(
      [],
    );
  });

  it('column without onAddTask shows no Add task controls', () => {
    render(
      <DndContext>
        <TaskColumn status="backlog" tasks={[]} />
        <TaskColumn status="inbox" tasks={[makeTask()]} />
      </DndContext>,
      { canEdit: false },
    );

    expect(screen.queryByText('Add task')).toBeNull();
    expect(screen.queryByTitle('Add task')).toBeNull();
    expect(screen.getByText('No tasks')).toBeInTheDocument();
  });

  it('list row disables completion', () => {
    render(
      <DndContext>
        <TaskRow task={makeTask()} />
      </DndContext>,
      { canEdit: false },
    );

    expect(screen.getByRole('button', { name: 'Complete task' })).toBeDisabled();
  });
});
