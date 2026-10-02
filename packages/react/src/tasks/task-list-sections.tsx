'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@repo/ui/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Task, TaskMetadata, TaskStatus } from '@repo/types';
import { TaskRow } from './task-row';
import { AddTaskRow } from './add-task-row';
import type { TaskSortMode } from '../lib/task-sort';
import type { TableColumn } from '../hooks/use-table-columns';

/**
 * Threshold for switching from flat rendering to virtualized rendering.
 * Sections with fewer items render all rows (preserving full DnD support).
 * Sections above this threshold use TanStack Virtual for efficient rendering.
 */
export const VIRTUALIZE_THRESHOLD = 50;
export const ROW_HEIGHT_ESTIMATE = 44;
export const VIRTUAL_OVERSCAN = 20;

/* -------------------------------------------------------------------------- */
/*  VirtualizedStatusSection                                                  */
/*  Renders a large list of TaskRows using TanStack Virtual.                  */
/*  Used for status groups (typically "done") that exceed VIRTUALIZE_THRESHOLD.*/
/* -------------------------------------------------------------------------- */

interface VirtualizedStatusSectionProps {
  status: TaskStatus;
  tasks: Task[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onEdit: (task: Task) => void;
  taskLookup: Map<string, Task>;
  readIds: Set<string> | null;
  completedIds: Set<string>;
  projectNames: Record<string, string>;
  showSprint?: boolean;
  sortMode: TaskSortMode;
  columns: TableColumn[];
  gridTemplate: string;
  canEdit: boolean;
  projectId?: string;
}

export function VirtualizedStatusSection({
  status,
  tasks,
  scrollContainerRef,
  onEdit,
  taskLookup,
  readIds,
  completedIds,
  projectNames,
  showSprint,
  sortMode,
  columns,
  gridTemplate,
  canEdit,
  projectId,
}: VirtualizedStatusSectionProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Measure offset from the list to the scroll container
  useLayoutEffect(() => {
    const el = listRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!el || !scrollEl) return;
    let offset = 0;
    let current: HTMLElement | null = el;
    while (current && current !== scrollEl) {
      offset += current.offsetTop;
      current = current.offsetParent as HTMLElement | null;
    }
    setScrollMargin(offset);
  });

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: VIRTUAL_OVERSCAN,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const visibleIds = useMemo(
    () => virtualItems.flatMap((vi) => tasks[vi.index]?.id ?? []),
    [virtualItems, tasks],
  );

  return (
    <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
      <div ref={listRef} className="ml-6 border-t border-(--celune-border-strong)">
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualItems.map((vItem) => {
            const task = tasks[vItem.index];
            if (!task) return null;
            return (
              <div
                key={task.id}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vItem.start - scrollMargin}px)`,
                }}
              >
                <TaskRow
                  task={task}
                  onEdit={onEdit}
                  taskLookup={taskLookup}
                  isUnread={!!readIds && !readIds.has(task.id)}
                  isJustCompleted={completedIds.has(task.id)}
                  projectName={task.project_id ? projectNames[task.project_id] : undefined}
                  showSprint={showSprint}
                  sortMode={sortMode}
                  columns={columns}
                  gridTemplate={gridTemplate}
                />
              </div>
            );
          })}
        </div>
        {canEdit && (
          <AddTaskRow
            status={status}
            projectId={projectId}
            columns={columns}
            gridTemplate={gridTemplate}
          />
        )}
      </div>
    </SortableContext>
  );
}

export function loadCollapsed(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem('task-list-collapsed') ?? '{}');
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/*  Sprint grouping helpers                                                    */
/* -------------------------------------------------------------------------- */

export const STATUS_SORT_ORDER: Record<string, number> = {
  in_progress: 0,
  review: 1,
  planning: 2,
  assigned: 3,
  inbox: 4,
  backlog: 5,
  done: 6,
};

export function getSprintLabel(sprint: number): string {
  if (sprint === 0) return 'Sprint 0 — PRD';
  if (sprint >= 99) return `Sprint ${sprint} — Closing`;
  return `Sprint ${sprint}`;
}

export interface SprintGroup {
  sprint: number;
  label: string;
  tasks: Task[];
  doneCount: number;
}

export function groupTasksBySprint(tasks: Task[]): SprintGroup[] {
  const map = new Map<number, Task[]>();
  for (const t of tasks) {
    const meta = (t.metadata ?? {}) as TaskMetadata;
    const sprint = meta.sprint ?? -1;
    const existing = map.get(sprint);
    if (existing) existing.push(t);
    else map.set(sprint, [t]);
  }

  const groups: SprintGroup[] = [];
  for (const [sprint, sprintTasks] of map) {
    // Sort within sprint by status order
    sprintTasks.sort(
      (a, b) => (STATUS_SORT_ORDER[a.status] ?? 5) - (STATUS_SORT_ORDER[b.status] ?? 5),
    );
    groups.push({
      sprint,
      label: sprint === -1 ? 'No Sprint' : getSprintLabel(sprint),
      tasks: sprintTasks,
      doneCount: sprintTasks.filter((t) => t.status === 'done').length,
    });
  }

  // Sort groups by sprint number (-1 = unassigned goes last)
  groups.sort((a, b) => {
    if (a.sprint === -1) return 1;
    if (b.sprint === -1) return -1;
    return a.sprint - b.sprint;
  });

  return groups;
}

export function SprintSectionHeader({
  group,
  collapsed,
  onToggle,
}: {
  group: SprintGroup;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const total = group.tasks.length;
  const done = group.doneCount;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = done === total && total > 0;

  return (
    <div className="group/header flex items-center py-2.5 pr-6 pl-6 select-none">
      <button type="button" onClick={onToggle} className="flex cursor-pointer items-center gap-3">
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-(--celune-fg-muted)" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-(--celune-fg-muted)" />
        )}
        <h3 className="text-sm font-(weight:--celune-font-weight-strong) text-(--celune-fg)">
          {group.label}
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-[4px] px-1.5 py-0.5 text-xs leading-none tabular-nums',
              allDone
                ? 'bg-(--celune-status-done)/10 text-(--celune-status-done)'
                : done > 0
                  ? 'bg-(--celune-primary)/10 text-(--celune-primary)'
                  : 'bg-(--celune-surface-hover) text-(--celune-fg-muted)',
            )}
          >
            {done}/{total}
          </span>
          {/* Progress bar */}
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-(--celune-surface-hover)">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                allDone ? 'bg-(--celune-status-done)' : 'bg-(--celune-primary)',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </button>
    </div>
  );
}
