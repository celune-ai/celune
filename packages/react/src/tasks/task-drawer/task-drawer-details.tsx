'use client';

import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Zap,
  ArrowLeftRight,
  Hash,
  ArrowUpRight,
  Activity,
  Circle,
  Brain,
  DollarSign,
} from 'lucide-react';
import { Badge } from '../../components/badge';
import { cn } from '@repo/ui/utils';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { formatTime } from '../../lib/date-utils';
import type { Task, TaskMetadata, AgentMemory } from './types';
import { buildDetailRows, renderGrid, LABEL_COLOR } from './task-drawer-details-rows';
import { useTaskDetails, type TaskUsage } from './use-task-details';

export interface TaskDrawerDetailsViewProps {
  task: Task;
  childTasks: Task[];
  allChildrenComplete: boolean;
  contextEntries: AgentMemory[];
  usage: TaskUsage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Render-only details accordion. Data comes from props. */
export function TaskDrawerDetailsView({
  task,
  childTasks,
  allChildrenComplete,
  contextEntries,
  usage,
  open,
  onOpenChange: setOpen,
}: TaskDrawerDetailsViewProps) {
  const { originRows, peopleRows, costRows, tsRows, sessionRows } = buildDetailRows(task);

  return (
    <div className="mt-6 border-t border-(--celune-border) px-5 pt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-1.5 py-2 text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase transition-opacity hover:opacity-80"
        style={{ color: LABEL_COLOR }}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Details
      </button>

      {open && (
        <div className="space-y-6 pb-2">
          {/* Identity & Origin */}
          {originRows.length > 0 && <div>{renderGrid(originRows)}</div>}

          {/* People & Workflow */}
          {peopleRows.length > 0 && (
            <div>
              <div className="mb-1">
                <p
                  className="text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase"
                  style={{ color: LABEL_COLOR }}
                >
                  People & Workflow
                </p>
              </div>
              {renderGrid(peopleRows)}
            </div>
          )}

          {/* Active Session */}
          {sessionRows.length > 0 && (
            <div>
              <div className="mb-1">
                <p
                  className="text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase"
                  style={{ color: LABEL_COLOR }}
                >
                  Live Status
                </p>
              </div>
              {renderGrid(sessionRows)}
            </div>
          )}

          {/* Time & Cost */}
          {costRows.length > 0 && (
            <div>
              <div className="mb-1">
                <p
                  className="text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase"
                  style={{ color: LABEL_COLOR }}
                >
                  Time & Cost
                </p>
              </div>
              {renderGrid(costRows)}
            </div>
          )}

          {/* Token Usage (from claude_usage table) */}
          {usage?.hasUsage && (
            <div>
              <div className="mb-1">
                <p
                  className="text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase"
                  style={{ color: LABEL_COLOR }}
                >
                  Token Usage
                </p>
              </div>
              {renderGrid([
                {
                  icon: <Zap className="h-3.5 w-3.5 shrink-0" />,
                  label: 'Total tokens',
                  value: (
                    <span className="tabular-nums">
                      {(usage.totalTokens ?? 0).toLocaleString()}
                    </span>
                  ),
                },
                {
                  icon: <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />,
                  label: 'In / Out',
                  value: (
                    <span className="tabular-nums">
                      {(usage.inputTokens ?? 0).toLocaleString()} /{' '}
                      {(usage.outputTokens ?? 0).toLocaleString()}
                    </span>
                  ),
                },
                ...(usage.cacheReadTokens && usage.cacheReadTokens > 0
                  ? [
                      {
                        icon: <Activity className="h-3.5 w-3.5 shrink-0" />,
                        label: 'Cache reads',
                        value: (
                          <span className="tabular-nums">
                            {usage.cacheReadTokens.toLocaleString()}
                          </span>
                        ),
                      },
                    ]
                  : []),
                {
                  icon: <DollarSign className="h-3.5 w-3.5 shrink-0" />,
                  label: 'Cost',
                  value: <span className="tabular-nums">${(usage.totalCost ?? 0).toFixed(4)}</span>,
                },
                {
                  icon: <Hash className="h-3.5 w-3.5 shrink-0" />,
                  label: 'Requests',
                  value: <span className="tabular-nums">{usage.requests}</span>,
                },
                ...(usage.models && usage.models.length > 0
                  ? [
                      {
                        icon: <Brain className="h-3.5 w-3.5 shrink-0" />,
                        label: 'Models',
                        value: (
                          <div className="flex flex-wrap gap-1">
                            {usage.models.map((m: string) => (
                              <Badge key={m} variant="secondary" className="text-xs">
                                {m}
                              </Badge>
                            ))}
                          </div>
                        ),
                      },
                    ]
                  : []),
              ])}
            </div>
          )}

          {/* Timestamps */}
          <div>
            <div className="mb-1">
              <p
                className="text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase"
                style={{ color: LABEL_COLOR }}
              >
                Timestamps
              </p>
            </div>
            {renderGrid(tsRows)}
          </div>

          {/* Parent task */}
          {task.parent_id && (
            <div>
              <div className="mb-1">
                <p
                  className="text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase"
                  style={{ color: LABEL_COLOR }}
                >
                  Parent Task
                </p>
              </div>
              <div className="flex items-center gap-1 text-sm text-(--celune-primary)">
                <ArrowUpRight className="h-3.5 w-3.5" />
                <span className="truncate">{task.parent_id}</span>
              </div>
            </div>
          )}

          {/* Child tasks */}
          {childTasks.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p
                  className="text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase"
                  style={{ color: LABEL_COLOR }}
                >
                  Child Tasks
                </p>
                <span className="text-xs" style={{ color: LABEL_COLOR }}>
                  {
                    childTasks.filter(
                      (c) => c.status === 'done' || c.status === ('archived' as string),
                    ).length
                  }
                  /{childTasks.length}
                  {allChildrenComplete && childTasks.length > 0 && ' (all complete)'}
                </span>
              </div>
              <div className="space-y-1.5">
                {childTasks.map((child) => {
                  const isDone = child.status === 'done' || child.status === ('archived' as string);
                  return (
                    <div key={child.id} className="flex items-center gap-2 text-sm">
                      {isDone ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-(--celune-status-done)" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 shrink-0 text-(--celune-fg-muted)" />
                      )}
                      <span className={cn(isDone && 'text-(--celune-fg-muted) line-through')}>
                        {child.title}
                      </span>
                      {child.assignee !== 'unassigned' && (
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {(TASK_ASSIGNEE_LABELS as Record<string, string>)[child.assignee] ??
                            child.assignee}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Context entries */}
          {contextEntries.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5 shrink-0" style={{ color: LABEL_COLOR }} />
                <p
                  className="text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase"
                  style={{ color: LABEL_COLOR }}
                >
                  Context
                </p>
              </div>
              <div className="space-y-2">
                {contextEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-(--celune-border)/50 bg-(--celune-surface) p-2.5"
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-xs capitalize">
                        {entry.category}
                      </Badge>
                      <span
                        className="truncate text-(length:--celune-text-3xs)"
                        style={{ color: LABEL_COLOR }}
                      >
                        {entry.key}
                      </span>
                    </div>
                    <p className="line-clamp-3 text-xs text-(--celune-fg)/80">{entry.content}</p>
                    <div
                      className="mt-1 flex items-center gap-2 text-(length:--celune-text-3xs)"
                      style={{ color: LABEL_COLOR }}
                    >
                      {entry.source && <span>src: {entry.source}</span>}
                      <span>{formatTime(entry.updated_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type TaskDrawerDetailsProps = Omit<
  TaskDrawerDetailsViewProps,
  'usage' | 'open' | 'onOpenChange'
>;

export function TaskDrawerDetails(props: TaskDrawerDetailsProps) {
  const { usage, open, setOpen } = useTaskDetails(props.task.id);
  return <TaskDrawerDetailsView {...props} usage={usage} open={open} onOpenChange={setOpen} />;
}
