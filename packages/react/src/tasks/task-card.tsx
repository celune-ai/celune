'use client';

import { memo, useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@repo/ui/components/card';
import { Badge } from '../components/badge';
import type { BadgeProps } from '../components/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/utils';
import type { Task, TaskMetadata, TaskAssignee } from '@repo/types';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { priorityLabels, priorityVariants } from '../lib/constants';
import { PRIORITY_TONE, TONE_FILL, toneStyle } from '../lib/tones';
import { AGENT_COLORS } from '../lib/agent-colors';
import { formatDueDate } from '../lib/date-utils';
import { toast } from 'sonner';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Circle,
  Link2,
  Loader2,
  Lock,
  Plus,
} from 'lucide-react';
import { DatePickerCalendar } from '../components/date-picker-calendar';
import { useCelune, useCeluneHref } from '../provider/context';
import { useElementClass } from '../provider/appearance';

/** Assignees shown in the quick-assign menu (heads + the owner) */
const ASSIGNABLE: TaskAssignee[] = [
  'eric',
  'rick',
  'sage',
  'noir',
  'scan',
  'delv',
  'trek',
  'echo',
  'bond',
  'vita',
];

interface TaskCardProps {
  task: Task;
  onEdit?: (task: Task) => void;
  taskLookup?: Map<string, Task>;

  isDragOverlay?: boolean;
  isUnread?: boolean;
  isJustCompleted?: boolean;
  projectName?: string;
  showSprint?: boolean;
}

export const TaskCard = memo(function TaskCard({
  task,
  onEdit,
  taskLookup,

  isDragOverlay,
  isUnread,
  isJustCompleted,
  projectName,
  showSprint,
}: TaskCardProps) {
  const partClass = useElementClass('taskCard');
  const { workspaceHref } = useCeluneHref();
  const { transport, canEdit } = useCelune();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit,
  });

  const [assigning, setAssigning] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [optimisticDone, setOptimisticDone] = useState(false);
  const [depsTooltipOpen, setDepsTooltipOpen] = useState(false);

  const isDone = task.status === 'done' || optimisticDone;

  const handleComplete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone || !canEdit) return;
    setOptimisticDone(true);
    try {
      await transport.tasks.update(task.id, { status: 'done' });
    } catch {
      setOptimisticDone(false);
    }
  };

  const completedSubtasks = task.subtasks?.filter((s) => s.done).length ?? 0;
  const totalSubtasks = task.subtasks?.length ?? 0;
  const meta = (task.metadata ?? {}) as TaskMetadata;
  const isActive = !!meta.active_session && task.status !== 'done';
  // Claimed/in-progress tasks have met their dependencies — don't show blocked state
  const isBlocked = !!meta.blocked && task.status !== 'in_progress';
  const isBlockedActive = isActive && isBlocked;
  const isScoped = !!meta.scoped_by && task.status === 'planning';
  const hasSubagent = !!meta.subagent_active && isActive;
  const isExecuting = !!meta.initiated && task.status === 'in_progress';

  // Resolve agent color from claimer or assignee
  const claimerId = meta.claimed_by ?? task.assignee;
  const agentColor = claimerId ? AGENT_COLORS[claimerId] : undefined;
  const agentTone = agentColor?.color ?? 'var(--celune-primary)';

  // Build inline style: CSS variable for the pulse animation, plus ring color for active state
  // NOTE: borderColor is set via className (not inline) so hover:border-* classes can override it
  const cardStyle = useMemo<React.CSSProperties>(
    () => ({
      backgroundColor: 'var(--celune-surface)',
      ...(isDragOverlay ? {} : { transform: CSS.Transform.toString(transform), transition }),
      ...(isActive || isJustCompleted
        ? ({ '--task-agent-color': agentTone } as React.CSSProperties)
        : {}),
      ...(isActive && !isBlocked
        ? { boxShadow: `0 0 0 2px color-mix(in srgb, ${agentTone} 60%, transparent)` }
        : {}),
      ...(isJustCompleted
        ? { boxShadow: `0 0 0 2px color-mix(in srgb, ${agentTone} 40%, transparent)` }
        : {}),
    }),
    [isDragOverlay, transform, transition, isActive, isJustCompleted, agentTone, isBlocked],
  );

  const handleAssign = async (assignee: TaskAssignee) => {
    setAssigning(true);
    try {
      await transport.tasks.update(task.id, { assignee });
    } catch {
      // Realtime or the next poll restores the server value
    } finally {
      setAssigning(false);
    }
  };

  const handleDueDateChange = async (date: string | null) => {
    await transport.tasks.update(task.id, { due_date: date }).catch(() => undefined);
  };

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}${workspaceHref(`/tasks?task=${task.id}`)}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  };

  return (
    <Card
      ref={isDragOverlay ? undefined : setNodeRef}
      style={cardStyle}
      data-task-card="true"
      className={cn(
        'group/card relative cursor-pointer rounded border-(--celune-border) transition-colors select-none hover:border-(--celune-fg-muted)/50 active:cursor-grabbing',
        isDragging && 'opacity-50',
        isDragOverlay && 'rotate-2 shadow-lg',
        isBlockedActive && 'ring-2 ring-(--celune-danger)/60',
        isActive && !isBlocked && 'animate-task-active',
        isJustCompleted && 'animate-task-complete',
        isDone && !isJustCompleted && 'opacity-50',
        partClass,
      )}
      onClick={() => onEdit?.(task)}
      {...(isDragOverlay ? {} : { ...attributes, ...listeners })}
    >
      <CardContent className="space-y-2 p-5">
        {/* Project name at top */}
        {projectName && task.project_id && (
          <div className="flex min-w-0 items-center gap-1 text-(--celune-fg-muted)">
            <a
              href={workspaceHref(`/projects/${task.project_id}`)}
              onClick={(e) => e.stopPropagation()}
              className="truncate text-xs font-(weight:--celune-font-weight-strong) hover:underline"
            >
              {projectName}
            </a>
            <ChevronRight className="h-3 w-3 shrink-0" />
          </div>
        )}

        {showSprint && meta.sprint != null && (
          <span className="text-(length:--celune-text-3xs) font-(weight:--celune-font-weight-medium) tracking-wider text-(--celune-fg-muted) uppercase">
            Sprint {meta.sprint}
          </span>
        )}

        {/* Title with checkbox — flex layout so wrapped text aligns with title, not checkbox */}
        <div className="mb-4 flex items-start gap-1.5">
          <button
            type="button"
            aria-label={isDone ? 'Completed' : 'Complete task'}
            disabled={!canEdit}
            className={cn(
              'mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-default',
              isDone
                ? 'text-(--celune-status-done)'
                : cn('text-(--celune-fg-muted)', canEdit && 'hover:text-(--celune-fg)'),
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleComplete(e);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isDone ? (
              <CheckCircle2 className="h-[18px] w-[18px]" />
            ) : (
              <Circle className="h-[18px] w-[18px]" />
            )}
          </button>
          <a
            href={workspaceHref(`/tasks?task=${task.id}`)}
            onClick={(e) => {
              e.preventDefault();
              onEdit?.(task);
            }}
            className="text-sm"
            style={{ fontWeight: 'var(--celune-font-weight-regular)', lineHeight: '160%' }}
          >
            {task.title}
          </a>
        </div>

        {/* Badges row: assignee/status left, priority right */}
        <div className="mt-1 flex items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {task.assignee === 'unassigned'
              ? canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed transition-colors"
                        style={{
                          borderColor: 'var(--celune-fg-muted)',
                          color: 'var(--celune-fg-muted)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                        disabled={assigning}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--celune-fg)';
                          e.currentTarget.style.borderColor = 'var(--celune-fg)';
                          e.currentTarget.style.backgroundColor = 'var(--celune-surface-hover)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'var(--celune-fg-muted)';
                          e.currentTarget.style.borderColor = 'var(--celune-fg-muted)';
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                      {ASSIGNABLE.map((id) => {
                        const color = AGENT_COLORS[id];
                        return (
                          <DropdownMenuItem key={id} onClick={() => handleAssign(id)}>
                            {color && (
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: color.color }}
                              />
                            )}
                            {TASK_ASSIGNEE_LABELS[id as keyof typeof TASK_ASSIGNEE_LABELS] ?? id}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              : (() => {
                  const assigneeColor = AGENT_COLORS[task.assignee];
                  return (
                    <Badge
                      variant="brand"
                      className="text-sm"
                      style={
                        assigneeColor
                          ? {
                              backgroundColor: assigneeColor.color,
                              color: 'var(--celune-on-status)',
                              borderColor: assigneeColor.color,
                            }
                          : undefined
                      }
                    >
                      {TASK_ASSIGNEE_LABELS[task.assignee as keyof typeof TASK_ASSIGNEE_LABELS] ??
                        task.assignee}
                    </Badge>
                  );
                })()}

            {/* Executing indicator */}
            {isExecuting && (
              <Badge
                variant="outline"
                className="gap-1 border-(--celune-status-scoping)/30 px-1.5 py-0 text-(length:--celune-text-3xs) text-(--celune-status-scoping)"
              >
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                Executing
              </Badge>
            )}

            {/* Unread dot / Calendar icon — dot shows by default, calendar replaces it on hover */}
            {!task.due_date && canEdit ? (
              <Tooltip>
                <DatePickerCalendar
                  value={task.due_date}
                  onChange={handleDueDateChange}
                  open={calendarOpen}
                  onOpenChange={setCalendarOpen}
                >
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="stagger-1 relative flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-transparent transition-all group-hover/card:border-(--celune-fg-muted) hover:!border-(--celune-fg) hover:bg-(--celune-surface-hover) hover:!text-(--celune-fg)"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCalendarOpen(true);
                      }}
                      style={{ color: 'var(--celune-fg-muted)' }}
                    >
                      {/* Unread dot — hidden on card hover, replaced by calendar */}
                      {isUnread && (
                        <span
                          className={cn(
                            'absolute inset-0 m-auto h-2 w-2 rounded-full transition-opacity group-hover/card:opacity-0',
                            task.status === 'done'
                              ? 'bg-(--celune-status-done)'
                              : 'bg-(--celune-status-scoping)',
                          )}
                        />
                      )}
                      {/* Calendar icon + border — visible on card hover */}
                      <Calendar
                        className={cn(
                          'stagger-1 h-3 w-3 transition-opacity',
                          'opacity-0 group-hover/card:opacity-100',
                        )}
                      />
                    </button>
                  </TooltipTrigger>
                </DatePickerCalendar>
                <TooltipContent side="top">Add due date</TooltipContent>
              </Tooltip>
            ) : isUnread ? (
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  task.status === 'done'
                    ? 'bg-(--celune-status-done)'
                    : 'bg-(--celune-status-scoping)',
                )}
              />
            ) : null}

            {/* Copy link — visible on card hover */}
            <button
              type="button"
              onClick={handleCopyLink}
              className="stagger-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-transparent text-(--celune-fg-muted) opacity-0 transition-all group-hover/card:border-(--celune-fg-muted) group-hover/card:opacity-100 hover:!border-(--celune-fg) hover:bg-(--celune-surface-hover) hover:!text-(--celune-fg)"
              title="Copy link"
            >
              <Link2 className="h-3 w-3" />
            </button>

            {task.parent_id && (
              <Badge variant="outline" className="text-sm">
                child
              </Badge>
            )}

            {isScoped && (
              <Badge variant="brand" className="text-sm">
                Scoped
              </Badge>
            )}

            {hasSubagent && (
              <Badge
                variant="outline"
                className="animate-pulse text-sm motion-reduce:animate-none"
                style={{
                  borderColor: `color-mix(in srgb, ${agentTone} 50%, transparent)`,
                  color: agentTone,
                }}
              >
                {meta.subagent_type ?? 'Sub-agent'}
              </Badge>
            )}
          </div>

          {task.effort && (
            <Badge
              variant="outline"
              className="shrink-0 px-1.5 py-0 text-(length:--celune-text-3xs)"
            >
              {task.effort}
            </Badge>
          )}
          {task.depends_on && task.depends_on.length > 0 ? (
            <Tooltip open={depsTooltipOpen} onOpenChange={setDepsTooltipOpen}>
              <TooltipTrigger asChild>
                <Badge variant="destructive-outline" className="shrink-0 cursor-default text-sm">
                  <Lock className="mr-0.5 h-3 w-3" />
                  {task.depends_on.length}
                </Badge>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="max-w-[260px] p-0"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="space-y-0.5 p-2">
                  <p className="mb-1 text-(length:--celune-text-3xs) font-(weight:--celune-font-weight-medium) tracking-wider text-(--celune-fg-muted) uppercase">
                    Blocked by
                  </p>
                  {task.depends_on.map((depId) => {
                    const depTask = taskLookup?.get(depId);
                    return (
                      <button
                        key={depId}
                        type="button"
                        className="flex w-full cursor-pointer items-start gap-1.5 text-left text-xs text-(--celune-fg) transition-colors hover:text-(--celune-primary)"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDepsTooltipOpen(false);
                          if (depTask) onEdit?.(depTask);
                        }}
                      >
                        <span className="line-clamp-1">{depTask?.title ?? depId.slice(0, 8)}</span>
                      </button>
                    );
                  })}
                </div>
              </TooltipContent>
            </Tooltip>
          ) : task.priority === 'urgent' || task.priority === 'high' ? (
            <Badge
              variant={priorityVariants[task.priority] as BadgeProps['variant']}
              className={cn('shrink-0 text-sm', TONE_FILL)}
              style={toneStyle(PRIORITY_TONE[task.priority])}
            >
              {priorityLabels[task.priority] ?? task.priority}
            </Badge>
          ) : null}
        </div>

        {task.due_date &&
          (() => {
            const due = formatDueDate(task.due_date);
            if (!due) return null;
            return (
              <p
                className={cn(
                  'flex items-center gap-1 text-(length:--celune-text-2xs)',
                  due.isOverdue ? 'text-(--celune-danger)' : 'text-(--celune-fg-muted)',
                )}
              >
                {due.isOverdue && <AlertCircle className="h-3 w-3 shrink-0" />}
                Due {due.label}
              </p>
            );
          })()}

        {totalSubtasks > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-(length:--celune-text-2xs) text-(--celune-fg-muted)">
              <span>
                {completedSubtasks}/{totalSubtasks} Subtasks
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-(--celune-surface-muted)">
              <div
                className="h-1 rounded-full bg-(--celune-status-done) transition-all"
                style={{
                  width: `${(completedSubtasks / totalSubtasks) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
