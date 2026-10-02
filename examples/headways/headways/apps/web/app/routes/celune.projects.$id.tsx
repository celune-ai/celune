import type { Route } from './+types/celune.projects.$id';
import { useProjectsQuery, useTasksQuery } from '@celuneai/react/hooks';
import { ProjectProgressLog } from '@celuneai/react/projects';
import { TaskBoard } from '@celuneai/react/tasks';
import { TopBar } from '#app/components/top-bar.js';
import { CeluneMount } from '#app/components/celune-mount.js';
import { useOrgPath } from '#app/lib/org-path.js';
import { loadCeluneEmbed } from '#server/celune.server.js';

export const meta = () => [{ title: 'Project · Headways' }];

export const loader = async ({ request, params }: Route.LoaderArgs) => ({
  embed: await loadCeluneEmbed(request, params.orgSlug),
  projectId: params.id,
});

function ProjectView({ projectId }: { projectId: string }) {
  const orgPath = useOrgPath();
  const { data: projects } = useProjectsQuery();
  const { data: tasks, isLoading } = useTasksQuery({ projectId });
  const project = projects?.find((p) => p.id === projectId);
  return (
    <>
      <TopBar
        breadcrumbs={[
          { label: 'Projects', to: orgPath('/projects') },
          { label: project?.name ?? 'Project' },
        ]}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-6 p-6">
        {project?.description ? (
          <p className="text-muted-foreground text-sm">{project.description}</p>
        ) : null}
        {isLoading || !tasks ? (
          <p className="text-muted-foreground text-sm">Loading tasks…</p>
        ) : (
          <TaskBoard initialTasks={tasks} projectId={projectId} />
        )}
        <ProjectProgressLog projectId={projectId} />
      </div>
    </>
  );
}

export default function CeluneProject({ loaderData }: Route.ComponentProps) {
  const { embed, projectId } = loaderData;
  if (!embed) return <TopBar title="Project" />;
  return (
    <CeluneMount embed={embed}>
      <ProjectView projectId={projectId} />
    </CeluneMount>
  );
}
