'use client';

import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { Badge } from '../components/badge';
import { cn } from '@repo/ui/utils';
import type { Project, ProjectStatus, ProjectType } from '@repo/types';
import { useCelune } from '../provider/context';
import { useElementClass } from '../provider/appearance';

const statusColors: Record<ProjectStatus, string> = {
  active: 'border-(--celune-primary) bg-(--celune-primary) text-(--celune-on-status)',
  paused: 'border-(--celune-status-review) bg-(--celune-status-review) text-(--celune-on-status)',
  completed: 'border-(--celune-status-done) bg-(--celune-status-done) text-(--celune-on-status)',
  archived:
    'border-(--celune-status-archived) bg-(--celune-status-archived) text-(--celune-on-status)',
};

interface ProjectCardProps {
  project: Project;
  taskCount?: number;
  doneCount?: number;
}

export function ProjectCard({ project, taskCount = 0, doneCount = 0 }: ProjectCardProps) {
  const partClass = useElementClass('projectCard');
  const { href: workspaceHref, Link } = useCelune();
  const pct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;

  return (
    <motion.div layout="position" transition={{ duration: 0.2 }}>
      <Link href={workspaceHref(`/projects/${project.id}`)}>
        <Card
          className={cn(
            'font-(family-name:--celune-font) text-(--celune-fg) transition-colors hover:border-(--celune-primary)/40',
            partClass,
          )}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">{project.name}</CardTitle>
              <Badge className={cn('shrink-0 text-xs', statusColors[project.status])}>
                {project.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {project.description && (
              <p className="line-clamp-2 text-sm text-(--celune-fg-muted)">{project.description}</p>
            )}

            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  'text-xs capitalize',
                  (project.project_type ?? 'feature') === 'research' &&
                    'border-(--celune-status-planning)/40 text-(--celune-status-planning)',
                  (project.project_type ?? 'feature') === 'plan' &&
                    'border-(--celune-priority-normal)/40 text-(--celune-priority-normal)',
                  (project.project_type ?? 'feature') === 'system' &&
                    'border-(--celune-status-review)/40 text-(--celune-status-review)',
                )}
              >
                {project.project_type ?? 'feature'}
              </Badge>
              {project.category && (
                <Badge variant="outline" className="text-xs">
                  {project.category}
                </Badge>
              )}
            </div>

            {taskCount > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-(--celune-fg-muted)">
                  <span>
                    {doneCount}/{taskCount} tasks
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-(--celune-surface-muted)">
                  <div
                    className="h-1.5 rounded-full bg-(--celune-status-done) transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {project.target_date && (
              <p className="text-(length:--celune-text-2xs) text-(--celune-fg-muted)">
                Target: {project.target_date}
              </p>
            )}
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
