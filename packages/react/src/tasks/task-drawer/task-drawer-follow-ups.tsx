'use client';

import { useState, useCallback } from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown, Circle, Loader2, CheckCircle2 } from 'lucide-react';
import { Badge } from '../../components/badge';
import { Button } from '@repo/ui/components/button';
import { cn } from '@repo/ui/utils';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { useCelune } from '../../provider/context';
import { toast } from 'sonner';
import { AGENT_COLORS } from '../../lib/agent-colors';
import type { Task } from './types';

interface TaskDrawerFollowUpsProps {
  taskId: string;
  followUpTasks: Task[];
  onTaskClick: (task: Task) => void;
  onTasksChanged: (tasks: Task[]) => void;
  projectNames?: Record<string, string>;
  defaultOpen?: boolean;
}

const LABEL_COLOR = 'var(--celune-fg-muted)';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function StatusIcon({ status }: { status: string }) {
  if (status === 'done')
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-(--celune-status-done)" />;
  if (status === 'in_progress')
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-(--celune-primary)" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-(--celune-fg-muted)" />;
}

export function TaskDrawerFollowUps({
  taskId,
  followUpTasks,
  onTaskClick,
  onTasksChanged,
  projectNames,
  defaultOpen = false,
}: TaskDrawerFollowUpsProps) {
  const { transport } = useCelune();
  const itemValue = 'additional-steps';
  const [openItems, setOpenItems] = useState<string[]>(defaultOpen ? [itemValue] : []);
  const [startingIds, setStartingIds] = useState<Set<string>>(new Set());

  const labels = TASK_ASSIGNEE_LABELS as Record<string, string>;
  const pendingTasks = followUpTasks.filter(
    (t) => t.status !== 'done' && t.status !== 'in_progress',
  );

  const startTask = useCallback(
    async (task: Task) => {
      setStartingIds((prev) => new Set(prev).add(task.id));

      // Optimistic update
      const updated = followUpTasks.map((t) =>
        t.id === task.id ? { ...t, status: 'in_progress' as Task['status'] } : t,
      );
      onTasksChanged(updated);

      try {
        await transport.tasks.update(task.id, { status: 'in_progress' });
        toast.success(`Started: ${task.title}`);
      } catch {
        // Revert optimistic update
        onTasksChanged(followUpTasks);
        toast.error(`Failed to start task`);
      } finally {
        setStartingIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }
    },
    [followUpTasks, onTasksChanged, transport],
  );

  const startAll = useCallback(async () => {
    const toStart = pendingTasks;
    if (toStart.length === 0) return;

    // Optimistic update all
    const updated = followUpTasks.map((t) =>
      toStart.some((p) => p.id === t.id) ? { ...t, status: 'in_progress' as Task['status'] } : t,
    );
    onTasksChanged(updated);

    const results = await Promise.allSettled(
      toStart.map((task) => transport.tasks.update(task.id, { status: 'in_progress' })),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      toast.error(`${failed} task(s) failed to start`);
    } else {
      toast.success(`Started ${toStart.length} task(s)`);
    }
  }, [followUpTasks, pendingTasks, onTasksChanged, transport]);

  return (
    <div className="flex flex-col px-5">
      <div className="my-6 border-t border-(--celune-border)" />
      <AccordionPrimitive.Root type="multiple" value={openItems} onValueChange={setOpenItems}>
        <AccordionPrimitive.Item value={itemValue} className="border-none">
          <AccordionPrimitive.Header className="flex items-center">
            <AccordionPrimitive.Trigger
              className={cn(
                'flex flex-1 items-center gap-1.5 py-0 text-left',
                '[&[data-state=open]>svg]:rotate-180',
              )}
            >
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-(--celune-fg-muted) transition-transform duration-200" />
              <p
                className="text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase"
                style={{ color: LABEL_COLOR }}
              >
                Additional Steps
              </p>
              {followUpTasks.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {followUpTasks.length}
                </Badge>
              )}
            </AccordionPrimitive.Trigger>
            {pendingTasks.length > 0 && (
              <Button variant="outline" size="md" onClick={startAll}>
                Start All
              </Button>
            )}
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Content className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm">
            <div className="space-y-1.5 pt-3 pb-1">
              {followUpTasks.length === 0 ? (
                <p className="text-sm text-(--celune-fg-muted)">No follow-up tasks</p>
              ) : (
                followUpTasks.map((task) => {
                  const agentColor = AGENT_COLORS[task.assignee];
                  const isPending = task.status !== 'done' && task.status !== 'in_progress';

                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 rounded-md border border-(--celune-border)/50 bg-(--celune-surface) px-3 py-2"
                    >
                      <StatusIcon status={task.status} />
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                        onClick={() => onTaskClick(task)}
                      >
                        {task.title}
                      </button>
                      {task.assignee !== 'unassigned' && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 text-xs"
                          style={
                            agentColor
                              ? { color: agentColor.color, borderColor: agentColor.color }
                              : undefined
                          }
                        >
                          {labels[task.assignee] ?? task.assignee}
                        </Badge>
                      )}
                      {task.project_id && projectNames?.[task.project_id] && (
                        <span
                          className="shrink-0 truncate text-(length:--celune-text-3xs)"
                          style={{ color: LABEL_COLOR }}
                        >
                          {projectNames[task.project_id]}
                        </span>
                      )}
                      {isPending && (
                        <Button
                          variant="outline"
                          size="md"
                          className="h-6 shrink-0 px-2 text-xs"
                          disabled={startingIds.has(task.id)}
                          onClick={() => startTask(task)}
                        >
                          Start
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      </AccordionPrimitive.Root>
    </div>
  );
}
