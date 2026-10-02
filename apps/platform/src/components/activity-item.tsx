'use client';

import Link from 'next/link';
import { Info, AlertTriangle, AlertOctagon } from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import { cn } from '@repo/ui/utils';
import type { ActivityEntry, SeverityLevel } from '@repo/types';
import { formatRelativeTime } from '@/lib/date-utils';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';

const severityConfig: Record<SeverityLevel, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'text-blue-500' },
  warning: { icon: AlertTriangle, className: 'text-yellow-500' },
  error: { icon: AlertOctagon, className: 'text-red-500' },
};

interface ActivityItemProps {
  entry: ActivityEntry;
}

export function ActivityItem({ entry }: ActivityItemProps) {
  const { workspaceHref } = useWorkspaceHref();
  const { icon: SeverityIcon, className: iconClass } = severityConfig[entry.severity];

  const content = (
    <div className="flex items-start gap-2 py-2">
      <SeverityIcon className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass)} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm leading-snug">{entry.title}</p>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Badge variant="secondary" className="text-xs">
            {entry.event_type}
          </Badge>
          {entry.source && <span>{entry.source}</span>}
          <span>{formatRelativeTime(entry.created_at)}</span>
        </div>
      </div>
    </div>
  );

  if (entry.task_id) {
    return (
      <Link
        href={workspaceHref(`/tasks?id=${entry.task_id}`)}
        className="hover:bg-muted/50 -mx-2 block rounded-md px-2 transition-colors"
      >
        {content}
      </Link>
    );
  }

  return <div className="-mx-2 px-2">{content}</div>;
}
