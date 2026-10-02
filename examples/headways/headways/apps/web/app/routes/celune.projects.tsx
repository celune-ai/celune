import { useMemo } from 'react';
import type { Route } from './+types/celune.projects';
import { useProjectsQuery, useTasksQuery } from '@celuneai/react/hooks';
import { ProjectCard } from '@celuneai/react/projects';
import { EmptyState } from '@repo/ui/empty-state';
import { TopBar } from '#app/components/top-bar.js';
import { CeluneMount } from '#app/components/celune-mount.js';
import { LadderIcon } from '#app/ui/icons.js';
import { loadCeluneEmbed } from '#server/celune.server.js';

export const meta = () => [{ title: 'Projects · Headways' }];

export const loader = async ({ request, params }: Route.LoaderArgs) => ({
  embed: await loadCeluneEmbed(request, params.orgSlug),
});

function ProjectGrid() {
  const { data: projects, isLoading } = useProjectsQuery();
  const { data: tasks } = useTasksQuery();
  const counts = useMemo(() => {
    const byProject: Record<string, { total: number; done: number }> = {};
    for (const task of tasks ?? []) {
      if (!task.project_id) continue;
      const entry = (byProject[task.project_id] ??= { total: 0, done: 0 });
      entry.total += 1;
      if (task.status === 'done') entry.done += 1;
    }
    return byProject;
  }, [tasks]);

  if (isLoading || !projects) {
    return <p className="text-muted-foreground text-sm">Loading projects…</p>;
  }
  if (projects.length === 0) {
    return (
      <EmptyState
        className="bg-card"
        icon={LadderIcon}
        title="No projects yet"
        description="Group related tasks into a project to track progress in one place."
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          taskCount={counts[project.id]?.total ?? 0}
          doneCount={counts[project.id]?.done ?? 0}
        />
      ))}
    </div>
  );
}

export default function CeluneProjects({ loaderData }: Route.ComponentProps) {
  const { embed } = loaderData;
  return (
    <>
      <TopBar title="Projects" />
      <div className="flex flex-1 flex-col gap-6 p-6">
        {embed ? (
          <CeluneMount embed={embed}>
            <ProjectGrid />
          </CeluneMount>
        ) : (
          <EmptyState
            className="bg-card"
            icon={LadderIcon}
            title="Projects are not set up for this organization"
            description="Link this organization to a Celune workspace to plan work and hand tasks to agents."
          />
        )}
      </div>
    </>
  );
}
