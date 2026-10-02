import { useMemo } from 'react';
import type { Route } from './+types/celune.tasks';
import { useProjectsQuery, useTasksQuery } from '@celuneai/react/hooks';
import { TaskBoard } from '@celuneai/react/tasks';
import { EmptyState } from '@repo/ui/empty-state';
import { TopBar } from '#app/components/top-bar.js';
import { CeluneMount } from '#app/components/celune-mount.js';
import { CircleCheckIcon } from '#app/ui/icons.js';
import { loadCeluneEmbed } from '#server/celune.server.js';

export const meta = () => [{ title: 'Tasks · Headways' }];

export const loader = async ({ request, params }: Route.LoaderArgs) => ({
  embed: await loadCeluneEmbed(request, params.orgSlug),
});

function Board() {
  const { data: tasks, isLoading } = useTasksQuery();
  const { data: projects } = useProjectsQuery();
  const projectNames = useMemo(
    () => Object.fromEntries((projects ?? []).map((p) => [p.id, p.name])),
    [projects],
  );
  if (isLoading || !tasks)
    return <p className="text-muted-foreground p-6 text-sm">Loading tasks…</p>;
  return <TaskBoard initialTasks={tasks} projectNames={projectNames} />;
}

export default function CeluneTasks({ loaderData }: Route.ComponentProps) {
  const { embed } = loaderData;
  return (
    <>
      <TopBar title="Tasks" />
      {embed ? (
        <CeluneMount embed={embed}>
          <div className="flex min-h-0 flex-1 flex-col p-6">
            <Board />
          </div>
        </CeluneMount>
      ) : (
        <div className="p-6">
          <EmptyState
            className="bg-card"
            icon={CircleCheckIcon}
            title="Tasks are not set up for this organization"
            description="Link this organization to a Celune workspace to plan work and hand tasks to agents."
          />
        </div>
      )}
    </>
  );
}
