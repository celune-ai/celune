'use client';

import { useDroppable } from '@dnd-kit/core';
import { TASK_STATUS_LABELS } from '@repo/types';
import type { TaskStatus } from '@repo/types';
import { cn } from '@repo/ui/utils';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@repo/ui/components/button';

interface TaskRowHeaderProps {
  status: TaskStatus;
  count: number;
  overdueCount: number;
  collapsed: boolean;
  onToggle: () => void;
  onAddTask?: (status: TaskStatus) => void;
  customHeader?: React.ReactNode;
  isDragOver?: boolean;
}

export function TaskRowHeader({
  status,
  count,
  overdueCount,
  collapsed,
  onToggle,
  onAddTask,
  customHeader,
  isDragOver,
}: TaskRowHeaderProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `header-${status}` });
  const highlighted = isDragOver || isOver;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group/header flex items-center py-2.5 pr-6 pl-6 transition-colors select-none',
        highlighted ? 'bg-(--celune-primary)/10' : 'bg-transparent',
      )}
    >
      {customHeader ?? (
        <>
          {/* Left side: toggle + title + count + add button */}
          <div className="flex min-w-0 flex-1 items-center">
            <button
              type="button"
              onClick={onToggle}
              className="flex cursor-pointer items-center gap-4"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-(--celune-fg-muted)" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-(--celune-fg-muted)" />
              )}
              <h3 className="text-base font-(weight:--celune-font-weight-strong) text-(--celune-fg)">
                {TASK_STATUS_LABELS[status]}
              </h3>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-[4px] px-1.5 py-0.5 text-xs leading-none tabular-nums',
                    count > 0
                      ? 'bg-(--celune-status-done)/10 text-(--celune-status-done)'
                      : 'bg-(--celune-surface-hover) text-(--celune-fg-muted)',
                  )}
                >
                  {count}
                </span>
                {status !== 'done' && overdueCount > 0 && (
                  <span className="rounded-[4px] bg-(--celune-danger)/10 px-1.5 py-0.5 text-(length:--celune-text-3xs) text-(--celune-danger) tabular-nums">
                    {overdueCount} overdue
                  </span>
                )}
              </div>
            </button>

            {/* Add task — appears on hover, next to the title/badge */}
            {onAddTask && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-2 h-7 w-7 text-(--celune-fg-muted) opacity-0 transition-opacity group-hover/header:opacity-100 hover:bg-(--celune-surface-hover)"
                onClick={() => onAddTask(status)}
                title="Add task"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Section options menu — placeholder, will be wired later */}
        </>
      )}
    </div>
  );
}
