import { makeProject, makeTask } from '../testing';

export const launchProject = makeProject({
  name: 'Open source launch',
  description: 'Ship the embeddable PM modules',
});

export const demoProjects = [
  launchProject,
  makeProject({ name: 'Self-host kit', status: 'paused', project_type: 'system' }),
];

export const demoTasks = [
  makeTask({
    title: 'Write the RFC',
    status: 'done',
    assignee: 'rick',
    project_id: launchProject.id,
  }),
  makeTask({
    title: 'Extract the provider',
    status: 'in_progress',
    priority: 'high',
    assignee: 'rick',
    project_id: launchProject.id,
  }),
  makeTask({
    title: 'Headless hooks',
    status: 'review',
    assignee: 'sage',
    project_id: launchProject.id,
  }),
  makeTask({
    title: 'Vite example',
    status: 'planning',
    effort: 'S',
    project_id: launchProject.id,
  }),
  makeTask({ title: 'Appearance tokens', status: 'scoping', priority: 'urgent', assignee: 'noir' }),
  makeTask({ title: 'Triage inbox', status: 'inbox', due_date: '2026-10-01' }),
];
