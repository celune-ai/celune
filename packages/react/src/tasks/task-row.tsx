'use client';

import { memo, useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '../components/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/utils';
import type { Task, TaskMetadata } from '@repo/types';
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  TASK_ASSIGNEE_LABELS,
  TASK_ASSIGNEES,
  TASK_PRIORITIES,
} from '@repo/types';
import {
  priorityLabels,
  priorityVariants,
  statusVariants,
  effortVariants,
  effortLabels,
  ASSIGNEE_BADGE_VARIANTS,
} from '../lib/constants';
import { EFFORT_TONE, PRIORITY_TONE, STATUS_TONE } from '../lib/tones';
import { AGENT_COLORS } from '../lib/agent-colors';
import { formatDueDate } from '../lib/date-utils';
import { useCelune } from '../provider/context';
import { AlertCircle, CheckCircle2, Circle, GripVertical, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { TableCellBadge, type CellBadgeOption } from '../components/table-cell-badge';
import {
  type ColumnId,
  type TableColumn,
  DEFAULT_COLUMNS,
  buildGridTemplate,
} from '../hooks/use-table-columns';
import { useElementClass } from '../provider/appearance';

interface TaskRowProps {
  task: Task;
  onEdit?: (task: Task) => void;
  taskLookup?: Map<string, Task>;
  isDragOverlay?: boolean;
  isUnread?: boolean;
  isJustCompleted?: boolean;
  projectName?: string;
  showSprint?: boolean;
  sortMode?: string;
  columns?: TableColumn[];
  gridTemplate?: string;
}

export const TaskRow = memo(function TaskRow({
  task,
  onEdit,
  taskLookup,
  isDragOverlay,
  isUnread,
  isJustCompleted,
  projectName,
  showSprint,
  sortMode,
  columns = DEFAULT_COLUMNS,
  gridTemplate,
}: TaskRowProps) {
  const partClass = useElementClass('taskRow');
  const { transport, canEdit } = useCelune();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit,
  });

  const [optimisticDone, setOptimisticDone] = useState(false);
  const [depsTooltipOpen, setDepsTooltipOpen] = useState(false);
  const isDone = task.status === 'done' || optimisticDone;
  const meta = (task.metadata ?? {}) as TaskMetadata;
  const isActive = !!meta.active_session && task.status !== 'done';
  const isBlocked = !!meta.blocked;
  const isExecuting = !!meta.initiated && task.status === 'in_progress';

  const claimerId = meta.claimed_by ?? task.assignee;
  const agentColor = claimerId ? AGENT_COLORS[claimerId] : undefined;
  const agentTone = agentColor?.color ?? 'var(--celune-primary)';

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

  const due = task.due_date ? formatDueDate(task.due_date) : null;

  const assigneeLabel =
    TASK_ASSIGNEE_LABELS[task.assignee as keyof typeof TASK_ASSIGNEE_LABELS] ?? task.assignee;

  const resolvedGrid = gridTemplate ?? buildGridTemplate(columns);

  const updateTaskField = async (field: string, value: string | null) => {
    try {
      await transport.tasks.update(task.id, { [field]: value });
    } catch {
      toast.error('Failed to update task');
    }
  };

  const statusOptions: CellBadgeOption[] = useMemo(
    () =>
      TASK_STATUSES.map((s) => ({
        value: s,
        label: TASK_STATUS_LABELS[s],
        variant: statusVariants[s] as CellBadgeOption['variant'],
        tone: STATUS_TONE[s],
      })),
    [],
  );

  const priorityOptions: CellBadgeOption[] = useMemo(
    () =>
      TASK_PRIORITIES.map((p) => ({
        value: p,
        label: priorityLabels[p] ?? p,
        variant: priorityVariants[p] as CellBadgeOption['variant'],
        tone: PRIORITY_TONE[p],
      })),
    [],
  );

  const assigneeOptions: CellBadgeOption[] = useMemo(
    () =>
      TASK_ASSIGNEES.map((a) => ({
        value: a,
        label: TASK_ASSIGNEE_LABELS[a],
        variant: (ASSIGNEE_BADGE_VARIANTS[a] ?? 'blue') as CellBadgeOption['variant'],
      })),
    [],
  );

  const effortOptions: CellBadgeOption[] = useMemo(
    () => [
      { value: '', label: 'None', variant: 'outline' as CellBadgeOption['variant'] },
      ...(['S', 'M', 'L'] as const).map((e) => ({
        value: e,
        label: effortLabels[e] ?? e,
        variant: effortVariants[e] as CellBadgeOption['variant'],
        tone: EFFORT_TONE[e],
      })),
    ],
    [],
  );

  const rowStyle: React.CSSProperties = {
    gridTemplateColumns: resolvedGrid,
    ...(isDragOverlay ? {} : { transform: CSS.Transform.toString(transform), transition }),
    ...(isActive && !isBlocked
      ? ({ '--task-agent-color': agentTone, borderLeftColor: agentTone } as React.CSSProperties)
      : {}),
    ...(isJustCompleted ? ({ '--task-agent-color': agentTone } as React.CSSProperties) : {}),
  };

  const renderCellContent = (colId: ColumnId) => {
    switch (colId) {
      case 'name':
        return (
          <>
            <button
              type="button"
              aria-label={isDone ? 'Completed' : 'Complete task'}
              disabled={!canEdit}
              className={cn(
                'shrink-0 transition-colors disabled:cursor-default',
                isDone
                  ? 'text-(--celune-status-done)'
                  : cn('text-(--celune-fg-muted)', canEdit && 'hover:text-(--celune-fg)'),
              )}
              onClick={handleComplete}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {isDone ? (
                <CheckCircle2 className="h-[18px] w-[18px]" />
              ) : (
                <Circle className="h-[18px] w-[18px]" />
              )}
            </button>
            <span
              className="min-w-0 truncate text-sm font-(weight:--celune-font-weight-medium) text-(--celune-fg) group-hover/row:underline"
              style={{ flexShrink: 1 }}
            >
              {task.title}
            </span>
            {isUnread && (
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  task.status === 'done' ? 'bg-(--celune-primary)' : 'bg-(--celune-status-scoping)',
                )}
              />
            )}
            {isExecuting && (
              <span className="flex shrink-0 items-center gap-0.5 text-(length:--celune-text-3xs) text-(--celune-status-scoping)">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              </span>
            )}
            {showSprint && meta.sprint != null && (
              <span className="ml-1 shrink-0 rounded bg-(--celune-surface-hover) px-1.5 py-0.5 text-(length:--celune-text-3xs) font-(weight:--celune-font-weight-medium) text-(--celune-fg-muted) tabular-nums">
                S{meta.sprint}
              </span>
            )}
            {projectName && (
              <span
                className="ml-1 min-w-0 truncate text-(length:--celune-text-2xs) text-(--celune-fg-muted) group-hover/row:underline"
                style={{ flexShrink: 10 }}
              >
                {projectName}
              </span>
            )}
          </>
        );

      case 'status':
        return (
          <TableCellBadge
            value={task.status}
            label={TASK_STATUS_LABELS[task.status]}
            options={statusOptions}
            variant={statusVariants[task.status] as CellBadgeOption['variant']}
            tone={STATUS_TONE[task.status]}
            onChange={canEdit ? (v) => updateTaskField('status', v) : undefined}
          />
        );

      case 'priority':
        if (task.depends_on && task.depends_on.length > 0) {
          return (
            <div className="flex items-center gap-1.5">
              <Tooltip open={depsTooltipOpen} onOpenChange={setDepsTooltipOpen}>
                <TooltipTrigger asChild>
                  <Badge
                    variant="coral-dark"
                    size="lg"
                    className="cursor-default border-(--celune-danger) text-(--celune-danger)"
                  >
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
                          <span className="line-clamp-1">
                            {depTask?.title ?? depId.slice(0, 8)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        }
        return (
          <TableCellBadge
            value={task.priority}
            label={priorityLabels[task.priority] ?? task.priority}
            options={priorityOptions}
            variant={priorityVariants[task.priority] as CellBadgeOption['variant']}
            tone={PRIORITY_TONE[task.priority]}
            onChange={canEdit ? (v) => updateTaskField('priority', v) : undefined}
          />
        );

      case 'assignee':
        return (
          <TableCellBadge
            value={task.assignee}
            label={assigneeLabel}
            fullLabel={assigneeLabel}
            options={assigneeOptions}
            variant={
              (ASSIGNEE_BADGE_VARIANTS[task.assignee] ?? 'blue') as CellBadgeOption['variant']
            }
            onChange={canEdit ? (v) => updateTaskField('assignee', v) : undefined}
            empty={task.assignee === 'unassigned'}
          />
        );

      case 'effort': {
        const effortValue = task.effort ?? (meta.effort as string) ?? '';
        const effortLabel = effortLabels[effortValue] ?? effortValue ?? '';
        return (
          <TableCellBadge
            value={effortValue}
            label={effortLabel}
            options={effortOptions}
            variant={(effortVariants[effortValue] ?? 'outline') as CellBadgeOption['variant']}
            tone={EFFORT_TONE[effortValue]}
            onChange={canEdit ? (v) => updateTaskField('effort', v || null) : undefined}
            empty={!effortValue}
          />
        );
      }

      case 'due':
        if (!due) {
          return <span className="text-sm text-(--celune-fg-muted)">–</span>;
        }
        return (
          <span
            className={cn(
              'text-xs whitespace-nowrap',
              due.isOverdue
                ? 'flex items-center gap-1 text-(--celune-danger)'
                : 'text-(--celune-fg-muted)',
            )}
          >
            {due.isOverdue && <AlertCircle className="h-3 w-3 shrink-0" />}
            {due.label}
          </span>
        );

      default:
        return null;
    }
  };

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={rowStyle}
      role="row"
      data-task-row="true"
      className={cn(
        'group/row grid cursor-pointer items-center border-b transition-colors',
        'border-(--celune-border-strong) hover:bg-(--celune-surface)',
        isDragging && 'opacity-50',
        isDragOverlay && 'rotate-1 rounded-md border bg-(--celune-surface-hover) shadow-lg',
        isActive && !isBlocked && 'animate-task-active border-l-2',
        isJustCompleted && 'animate-task-complete',
        isDone && !isJustCompleted && 'opacity-50',
        partClass,
      )}
      onClick={() => onEdit?.(task)}
      {...(isDragOverlay ? {} : { ...attributes })}
    >
      {/* Fixed drag handle column */}
      <div className="flex items-center justify-center self-stretch py-1 pl-3">
        <button
          type="button"
          className={cn(
            'opacity-0 transition-opacity group-hover/row:opacity-60 hover:!opacity-100',
            sortMode === 'manual' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
          )}
          {...(isDragOverlay || sortMode !== 'manual' ? {} : { ...listeners })}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 text-(--celune-fg-muted)" />
        </button>
      </div>

      {/* Dynamic content columns */}
      {columns.map((col, i) => {
        const isBadgeCell = ['status', 'priority', 'assignee', 'effort'].includes(col.id);
        return (
          <div
            key={col.id}
            className={cn(
              'flex self-stretch',
              isBadgeCell ? 'items-stretch' : 'items-center py-1',
              i > 0 && 'border-l border-(--celune-border-strong)',
              col.id === 'name' ? 'min-w-0 gap-2 pl-3' : 'pl-3',
              col.id === 'assignee' && 'truncate',
            )}
          >
            {renderCellContent(col.id)}
          </div>
        );
      })}
    </div>
  );
});
