import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { TaskBoard, TaskListView, TaskDrawer } from '../tasks';
import { Lock } from 'lucide-react';
import { CeluneTestProvider, createMockTransport, type CeluneTestProviderProps } from '../testing';
import { demoProjects, demoTasks } from './fixtures';

const projectNames = Object.fromEntries(demoProjects.map((p) => [p.id, p.name]));

function WithMock({
  children,
  readOnly,
  empty,
  ...props
}: Omit<CeluneTestProviderProps, 'transport'> & { readOnly?: boolean; empty?: boolean }) {
  const [transport] = useState(() =>
    createMockTransport(
      { tasks: empty ? [] : demoTasks, projects: demoProjects },
      { latency: 150 },
    ),
  );
  return (
    <CeluneTestProvider transport={transport} canEdit={!readOnly} {...props}>
      {children}
    </CeluneTestProvider>
  );
}

/**
 * What a Celune Cloud `ee` gate renders into the drawerBanner slot when a feature is locked.
 * The open build passes no slot, so the drawer renders nothing there (see the Drawer story).
 */
function LockedAgentRuns() {
  return (
    <div className="mx-5 mt-4 mb-3 flex items-center gap-3 rounded border border-(--celune-border) bg-(--celune-surface-muted) px-4 py-3 text-(length:--celune-text-sm)">
      <Lock className="h-4 w-4 shrink-0 text-(--celune-fg-muted)" aria-hidden />
      <span className="flex-1 text-(--celune-fg-muted)">
        Agent runs on this task need a Celune Cloud plan.
      </span>
      <a
        href="#plans"
        className="font-(weight:--celune-font-weight-strong) text-(--celune-fg) underline underline-offset-2"
      >
        See plans
      </a>
    </div>
  );
}

const meta: Meta = { title: 'Tasks' };
export default meta;

export const Board: StoryObj = {
  render: () => (
    <WithMock>
      <div className="h-[720px]">
        <TaskBoard initialTasks={demoTasks} projectNames={projectNames} />
      </div>
    </WithMock>
  ),
};

export const List: StoryObj = {
  render: () => (
    <WithMock>
      <TaskListView initialTasks={demoTasks} projectNames={projectNames} />
    </WithMock>
  ),
};

export const ReadOnlyBoard: StoryObj = {
  render: () => (
    <WithMock readOnly>
      <div className="h-[720px]">
        <TaskBoard initialTasks={demoTasks} projectNames={projectNames} />
      </div>
    </WithMock>
  ),
};

export const Drawer: StoryObj = {
  render: () => (
    <WithMock>
      <TaskDrawer
        open
        task={demoTasks[1] ?? null}
        onClose={() => undefined}
        onSaved={() => undefined}
      />
    </WithMock>
  ),
};

export const LoadingBoard: StoryObj = {
  render: () => (
    <WithMock>
      <div className="flex h-[720px] flex-col">
        <TaskBoard initialTasks={[]} loading />
      </div>
    </WithMock>
  ),
};

export const LoadingList: StoryObj = {
  render: () => (
    <WithMock>
      <div className="flex h-[520px] flex-col">
        <TaskListView initialTasks={[]} loading />
      </div>
    </WithMock>
  ),
};

export const LoadingDrawer: StoryObj = {
  render: () => (
    <WithMock>
      <TaskDrawer open loading task={null} onClose={() => undefined} onSaved={() => undefined} />
    </WithMock>
  ),
};

export const EmptyBoard: StoryObj = {
  render: () => (
    <WithMock empty>
      <div className="flex h-[480px] flex-col">
        <TaskBoard initialTasks={[]} />
      </div>
    </WithMock>
  ),
};

export const EmptyBoardReadOnly: StoryObj = {
  render: () => (
    <WithMock empty readOnly>
      <div className="flex h-[480px] flex-col">
        <TaskBoard initialTasks={[]} />
      </div>
    </WithMock>
  ),
};

/** Realtime absent: the board polls and shows a quiet stamp above the last column. */
export const PollingBoard: StoryObj = {
  render: () => (
    <WithMock pollInterval={5000}>
      <div className="flex h-[720px] flex-col">
        <TaskBoard initialTasks={demoTasks} projectNames={projectNames} />
      </div>
    </WithMock>
  ),
};

export const LockedDrawer: StoryObj = {
  render: () => (
    <WithMock slots={{ drawerBanner: <LockedAgentRuns /> }}>
      <TaskDrawer
        open
        task={demoTasks[1] ?? null}
        onClose={() => undefined}
        onSaved={() => undefined}
      />
    </WithMock>
  ),
};
