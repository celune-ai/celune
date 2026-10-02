import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProjectCard, ProjectTable } from '../projects';
import { CeluneTestProvider, createMockTransport } from '../testing';
import { demoProjects, launchProject } from './fixtures';

const transport = createMockTransport({ projects: demoProjects });
const counts = Object.fromEntries(
  demoProjects.map((p, i) => [p.id, { taskCount: 6 - i * 2, doneCount: 1 }]),
);

const meta: Meta = { title: 'Projects' };
export default meta;

export const Table: StoryObj = {
  render: () => (
    <CeluneTestProvider transport={transport}>
      <ProjectTable projects={demoProjects} projectCounts={counts} />
    </CeluneTestProvider>
  ),
};

export const Card: StoryObj = {
  render: () => (
    <CeluneTestProvider transport={transport}>
      <div className="max-w-sm">
        <ProjectCard project={launchProject} taskCount={6} doneCount={1} />
      </div>
    </CeluneTestProvider>
  ),
};
