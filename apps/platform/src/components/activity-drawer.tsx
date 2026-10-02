'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/utils';
import type { ActivityEntry, SeverityLevel } from '@repo/types';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';

const SEVERITY_STYLES: Record<SeverityLevel, string> = {
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  warning: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  error: 'bg-red-500/15 text-red-400 border-red-500/20',
};

interface ActivityDrawerProps {
  open: boolean;
  entry: ActivityEntry | null;
  onClose: () => void;
}

export function ActivityDrawer({ open, entry, onClose }: ActivityDrawerProps) {
  const { workspaceHref } = useWorkspaceHref();
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const formatted = entry
    ? new Date(entry.created_at).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
    : '';

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry ? `Activity: ${entry.title}` : 'Activity detail'}
        className={cn(
          'border-border bg-surface-75 fixed top-0 right-0 z-[61] flex h-full w-2/5 min-w-[420px] flex-col border-l shadow-2xl transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="border-border flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
          <p className="text-sm leading-snug font-medium">{entry?.title ?? 'Activity Detail'}</p>
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onClose}
                  aria-label="Close activity drawer"
                  className="text-foreground-lighter hover:bg-surface-200 hover:text-foreground shrink-0 rounded-md p-1 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Close
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {entry && (
          <div className="scrollbar-dark flex-1 space-y-5 overflow-y-auto px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                  SEVERITY_STYLES[entry.severity],
                )}
              >
                {entry.severity}
              </span>
              <Badge variant="secondary" className="text-xs font-normal">
                {entry.event_type}
              </Badge>
              {entry.source && (
                <span className="text-muted-foreground text-xs">{entry.source}</span>
              )}
            </div>

            <div>
              <p className="text-foreground-lighter mb-1 text-xs font-medium tracking-wider uppercase">
                Timestamp
              </p>
              <p className="text-sm tabular-nums">{formatted}</p>
            </div>

            {entry.agent_id && (
              <div>
                <p className="text-foreground-lighter mb-1 text-xs font-medium tracking-wider uppercase">
                  Agent
                </p>
                <p className="font-mono text-sm">{entry.agent_id}</p>
              </div>
            )}

            {entry.task_id && (
              <div>
                <p className="text-foreground-lighter mb-1 text-xs font-medium tracking-wider uppercase">
                  Linked Task
                </p>
                <a
                  href={workspaceHref(`/tasks?id=${entry.task_id}`)}
                  className="text-brand font-mono text-sm hover:underline"
                >
                  {entry.task_id}
                </a>
              </div>
            )}

            {entry.details && Object.keys(entry.details).length > 0 && (
              <div>
                <p className="text-foreground-lighter mb-2 text-xs font-medium tracking-wider uppercase">
                  Metadata
                </p>
                <div className="border-border overflow-hidden rounded-lg border">
                  {Object.entries(entry.details).map(([k, v], idx, arr) => (
                    <div
                      key={k}
                      className={cn(
                        'flex gap-4 px-3 py-2 text-xs',
                        idx !== arr.length - 1 && 'border-border/50 border-b',
                        'hover:bg-surface-100/30',
                      )}
                    >
                      <span className="text-foreground-lighter w-32 shrink-0 truncate font-mono font-medium">
                        {k}
                      </span>
                      <span className="text-foreground break-all">
                        {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-foreground-lighter mb-1 text-xs font-medium tracking-wider uppercase">
                ID
              </p>
              <p className="text-muted-foreground font-mono text-xs">{entry.id}</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
