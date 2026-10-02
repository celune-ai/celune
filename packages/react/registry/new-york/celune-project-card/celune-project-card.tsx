'use client';

import { useProjectsQuery } from '@celuneai/react/hooks';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Project = NonNullable<ReturnType<typeof useProjectsQuery>['data']>[number];

export interface CeluneProjectCardProps {
  project: Project;
  taskCount?: number;
  doneCount?: number;
  href?: string;
  className?: string;
}

export function CeluneProjectCard({
  project,
  taskCount = 0,
  doneCount = 0,
  href,
  className,
}: CeluneProjectCardProps) {
  const pct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;
  const body = (
    <Card className={cn('hover:border-ring transition-colors', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{project.name}</CardTitle>
          <Badge variant="secondary" className="capitalize">
            {String(project.status).replace('_', ' ')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: 'var(--celune-status-done, var(--primary))',
            }}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {doneCount} of {taskCount} tasks done
        </p>
      </CardContent>
    </Card>
  );
  return href ? <a href={href}>{body}</a> : body;
}
