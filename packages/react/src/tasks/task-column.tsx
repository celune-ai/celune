'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AnimatePresence, motion } from 'framer-motion';
import { TaskCard } from './task-card';
import { TASK_STATUS_LABELS } from '@repo/types';
import type { Task, TaskStatus } from '@repo/types';
import type { TaskSortMode } from '../lib/task-sort';
import { countOverdue } from '../lib/task-sort';
import { priorityWeight } from '../lib/constants';
import { Button } from '@repo/ui/components/button';
import { Plus } from 'lucide-react';
import { cn } from '@repo/ui/utils';
import { useElementClass } from '../provider/appearance';

interface TaskColumnProps {
  status: TaskStatus;
  tasks: Task[];
  taskLookup?: Map<string, Task>;
  onEditTask?: (task: Task) => void;
  onAddTask?: (status: TaskStatus) => void;
  readTaskIds?: Set<string>;
  completedIds?: Set<string>;
  projectNames?: Record<string, string>;
  isDragOver?: boolean;
  customHeader?: React.ReactNode;
  skeletonCard?: React.ReactNode;
  sortMode?: TaskSortMode;
  today?: string;
  isFirst?: boolean;
  isLast?: boolean;
  showSprint?: boolean;
}

export function TaskColumn({
  status,
  tasks,
  taskLookup,
  onEditTask,
  onAddTask,
  readTaskIds,
  completedIds,
  projectNames,
  isDragOver,
  customHeader,
  skeletonCard,
  sortMode = 'manual',
  today,
  isFirst,
  isLast,
  showSprint,
}: TaskColumnProps) {
  const partClass = useElementClass('boardColumn');
  const { setNodeRef } = useDroppable({ id: status });
  const isEmpty = tasks.length === 0;
  const isOver = isDragOver ?? false;

  return (
    <div
      className={cn('group/col flex w-[300px] min-w-[300px] shrink-0 flex-col', partClass)}
      style={{
        height: 'max-content',
        maxHeight: '100%',
        marginLeft: isFirst ? '24px' : undefined,
        marginRight: isLast ? '24px' : undefined,
      }}
    >
      {/* Column header */}
      <div
        className="flex shrink-0 items-center justify-between rounded py-3 select-none"
        style={{
          backgroundColor: 'var(--celune-surface-muted)',
          marginBottom: '8px',
          paddingLeft: '10px',
          paddingRight: '10px',
        }}
      >
        {customHeader ?? (
          <>
            <div className="flex items-center gap-2.5">
              <h3
                className="font-(weight:--celune-font-weight-strong)"
                style={{ fontSize: 'var(--celune-text-base)' }}
              >
                {TASK_STATUS_LABELS[status]}
              </h3>
              <span
                className={`text-xs leading-none tabular-nums ${
                  tasks.length > 0
                    ? 'rounded-[4px] bg-(--celune-status-done)/10 px-1.5 py-0.5 text-(--celune-status-done)'
                    : 'rounded-[4px] bg-(--celune-surface-hover) px-1.5 py-0.5 text-(--celune-fg-muted)'
                }`}
              >
                {tasks.length}
              </span>
              {status !== 'done' &&
                today &&
                (() => {
                  const overdue = countOverdue(tasks, today);
                  if (overdue === 0) return null;
                  return (
                    <span className="rounded-[4px] bg-(--celune-danger)/10 px-1.5 py-0.5 text-(length:--celune-text-3xs) text-(--celune-danger) tabular-nums">
                      {overdue} overdue
                    </span>
                  );
                })()}
            </div>
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/col:opacity-100">
              {onAddTask && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-(--celune-fg-muted)"
                  onClick={() => onAddTask(status)}
                  title="Add task"
                  aria-label={`Add task to ${TASK_STATUS_LABELS[status]}`}
                >
                  <Plus className="h-4.5 w-4.5" />
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Card area — scrolls within column */}
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`scroll-overlay flex min-h-0 flex-1 flex-col gap-2 rounded border-0 py-2 pr-1 pl-2 transition-colors duration-150 ${
            isOver ? 'bg-(--celune-primary)/5' : ''
          }`}
          style={{
            backgroundColor: isOver ? undefined : 'var(--celune-surface-muted)',
            minHeight: isEmpty ? 100 : undefined,
            overflow: 'overlay' as string,
          }}
        >
          {isEmpty && !skeletonCard && !onAddTask ? (
            <div
              className="flex h-[100px] items-center justify-center rounded-lg border border-dashed border-(--celune-fg-muted)/40 select-none"
              style={{ color: 'var(--celune-fg-muted)', fontSize: 'var(--celune-text-sm)' }}
            >
              No tasks
            </div>
          ) : isEmpty && !skeletonCard ? (
            <button
              type="button"
              onClick={() => onAddTask?.(status)}
              className={`flex h-[100px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed transition-colors ${
                isOver
                  ? 'border-(--celune-primary)/40 bg-(--celune-primary)/5'
                  : 'border-(--celune-fg-muted)/40 hover:border-(--celune-fg-muted) hover:bg-(--celune-surface-hover)'
              }`}
            >
              <Plus
                className="h-3.5 w-3.5"
                style={{ color: 'var(--celune-fg-muted)' }}
                strokeDasharray="2 2"
              />
              <span
                className="font-(weight:--celune-font-weight-strong) select-none"
                style={{ color: 'var(--celune-fg-muted)', fontSize: 'var(--celune-text-sm)' }}
              >
                {isOver ? 'Drop here' : 'Add task'}
              </span>
            </button>
          ) : (
            <>
              {skeletonCard}
              <AnimatePresence initial={false}>
                {tasks.map((task, idx) => {
                  const prevTask = idx > 0 ? tasks[idx - 1] : undefined;
                  const showDivider =
                    sortMode === 'priority' &&
                    prevTask !== undefined &&
                    (priorityWeight[task.priority] ?? 2) !==
                      (priorityWeight[prevTask.priority] ?? 2);

                  return (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                    >
                      {showDivider && (
                        <div className="my-1 border-t border-dashed border-(--celune-border)/30" />
                      )}
                      <TaskCard
                        task={task}
                        onEdit={onEditTask}
                        taskLookup={taskLookup}
                        isUnread={readTaskIds ? !readTaskIds.has(task.id) : false}
                        isJustCompleted={completedIds?.has(task.id)}
                        projectName={task.project_id ? projectNames?.[task.project_id] : undefined}
                        showSprint={showSprint}
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* + Add Task footer */}
              {onAddTask && (
                <button
                  type="button"
                  className="mt-1 mb-1 flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-transparent py-2.5 pr-3 pl-4 font-(weight:--celune-font-weight-strong) transition-colors hover:border-(--celune-border) hover:bg-(--celune-surface)"
                  style={{ fontSize: 'var(--celune-text-sm)', color: 'var(--celune-fg-muted)' }}
                  onClick={() => onAddTask?.(status)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--celune-fg)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--celune-fg-muted)';
                  }}
                >
                  <Plus className="h-3 w-3" />
                  <span>Add task</span>
                </button>
              )}
            </>
          )}
        </div>
      </SortableContext>
    </div>
  );
}
