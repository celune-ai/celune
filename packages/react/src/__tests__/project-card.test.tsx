import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { ProjectCard } from '../projects/project-card';
import { renderWithCelune } from './utils';
import type { Project } from '@repo/types';

const render = (ui: React.ReactElement) => renderWithCelune(ui, { href: (path) => `/main${path}` });

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: null,
    status: 'active',
    project_type: 'feature',
    priority: 'medium',
    category: null,
    target_date: null,
    vault_path: null,
    metadata: null,
    prd_content: null,
    prd_metadata: null,
    group_id: null,
    user_id: null,
    org_id: null,
    workspace_id: null,
    sort_order: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ProjectCard', () => {
  it('renders project name', () => {
    render(<ProjectCard project={makeProject({ name: 'Platform v2' })} />);

    expect(screen.getByText('Platform v2')).toBeDefined();
  });

  it('renders status badge', () => {
    render(<ProjectCard project={makeProject({ status: 'paused' })} />);

    expect(screen.getByText('paused')).toBeDefined();
  });

  it('renders description when provided', () => {
    render(<ProjectCard project={makeProject({ description: 'A cool project' })} />);

    expect(screen.getByText('A cool project')).toBeDefined();
  });

  it('does not render description when null', () => {
    render(<ProjectCard project={makeProject({ description: null })} />);

    expect(screen.queryByText('A cool project')).toBeNull();
  });

  it('links to the project detail page', () => {
    const { container } = render(<ProjectCard project={makeProject({ id: 'proj-42' })} />);

    const link = container.querySelector('a[href="/main/projects/proj-42"]');
    expect(link).not.toBeNull();
  });

  it('renders task progress when taskCount > 0', () => {
    render(<ProjectCard project={makeProject()} taskCount={10} doneCount={3} />);

    expect(screen.getByText('3/10 tasks')).toBeDefined();
    expect(screen.getByText('30%')).toBeDefined();
  });

  it('does not render progress when taskCount is 0', () => {
    render(<ProjectCard project={makeProject()} taskCount={0} doneCount={0} />);

    expect(screen.queryByText('tasks')).toBeNull();
  });

  it('renders target date when provided', () => {
    render(<ProjectCard project={makeProject({ target_date: '2026-06-01' })} />);

    expect(screen.getByText('Target: 2026-06-01')).toBeDefined();
  });

  it('renders category badge when provided', () => {
    render(<ProjectCard project={makeProject({ category: 'security' })} />);

    expect(screen.getByText('security')).toBeDefined();
  });

  it('renders system badge for system type', () => {
    render(<ProjectCard project={makeProject({ project_type: 'system' })} />);

    expect(screen.getByText('system')).toBeDefined();
  });

  it('calculates progress percentage correctly', () => {
    render(<ProjectCard project={makeProject()} taskCount={3} doneCount={1} />);

    expect(screen.getByText('33%')).toBeDefined();
  });
});
