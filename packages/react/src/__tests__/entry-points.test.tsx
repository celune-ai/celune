import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import * as root from '..';
import { TaskBoard, TaskListView } from '../tasks';
import { ProjectTable } from '../projects';
import { useProjectsQuery, useTasksQuery } from '../hooks';
import { createMockTransport, makeProject, makeTask } from '../testing';
import { renderWithCelune } from './utils';

const tasks = [
  makeTask({ title: 'Write the provider', status: 'in_progress' }),
  makeTask({ title: 'Ship the board', status: 'planning' }),
];

describe('entry points', () => {
  it('root exports the provider and the REST transport', () => {
    expect(typeof root.CeluneProvider).toBe('function');
    expect(typeof root.createRestTransport).toBe('function');
  });

  it('@celuneai/react/tasks renders the board against a mocked transport', () => {
    renderWithCelune(<TaskBoard initialTasks={tasks} />, {
      transport: createMockTransport({ tasks }),
    });
    expect(screen.getByText('Write the provider')).toBeInTheDocument();
    expect(screen.getByText('Ship the board')).toBeInTheDocument();
  });

  it('@celuneai/react/tasks renders the list view', () => {
    renderWithCelune(<TaskListView initialTasks={tasks} />, {
      transport: createMockTransport({ tasks }),
    });
    expect(screen.getByText('Write the provider')).toBeInTheDocument();
  });

  it('@celuneai/react/projects renders the project table', () => {
    const project = makeProject({ name: 'Open source launch' });
    renderWithCelune(
      <ProjectTable
        projects={[project]}
        projectCounts={{ [project.id]: { taskCount: 2, doneCount: 1 } }}
      />,
      { transport: createMockTransport({ projects: [project] }) },
    );
    expect(screen.getByText('Open source launch')).toBeInTheDocument();
  });

  it('@celuneai/react/hooks loads data through the transport', async () => {
    function Lists() {
      const t = useTasksQuery();
      const p = useProjectsQuery();
      return (
        <ul>
          {t.data?.map((task) => (
            <li key={task.id}>{task.title}</li>
          ))}
          {p.data?.map((project) => (
            <li key={project.id}>{project.name}</li>
          ))}
        </ul>
      );
    }
    renderWithCelune(<Lists />, {
      transport: createMockTransport({ tasks, projects: [makeProject({ name: 'Headless' })] }),
    });
    await waitFor(() => expect(screen.getByText('Ship the board')).toBeInTheDocument());
    expect(screen.getByText('Headless')).toBeInTheDocument();
  });
});
