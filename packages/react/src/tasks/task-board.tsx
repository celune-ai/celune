'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  pointerWithin,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { TaskColumn } from './task-column';
import { TaskCard } from './task-card';
import { TaskCardSkeleton, type SkeletonPhase } from './task-card-skeleton';
import { SyncStamp, TaskBoardSkeleton, TasksEmptyState } from './task-states';
import { TaskDialog } from './task-dialog';
import { persistTaskReorder } from '../lib/reorder';
import { TaskDrawer } from './task-drawer';
import { DoneFilterToggle, type DoneFilters } from '../components/done-filter-toggle';
import { useReadTasks } from '../hooks/use-read-tasks';
import { useTasksRealtime } from '../hooks/use-tasks-realtime';
import { TASK_STATUSES } from '@repo/types';
import type { Task, TaskStatus } from '@repo/types';
import { sortTasksForDisplay, type TaskSortMode } from '../lib/task-sort';
import { TooltipProvider } from '@repo/ui/components/tooltip';
import { useCelune } from '../provider/context';
import { toast } from 'sonner';
import { cn } from '@repo/ui/utils';
import { useElementClass } from '../provider/appearance';

interface TaskBoardProps {
  initialTasks: Task[];
  projectId?: string;
  projectNames?: Record<string, string>;
  sortMode?: TaskSortMode;
  showSprint?: boolean;
  onDragReorder?: () => void;
  hiddenStatuses?: Set<TaskStatus>;
  /** Shows skeleton columns in place of the board while the host loads tasks. */
  loading?: boolean;
}

export interface TaskBoardHandle {
  openNewTask: () => void;
}

const TaskBoardComponent = forwardRef<TaskBoardHandle, TaskBoardProps>(function TaskBoard(
  {
    initialTasks,
    projectId,
    projectNames = {},
    sortMode = 'manual',
    showSprint,
    onDragReorder,
    hiddenStatuses,
    loading = false,
  },
  ref,
) {
  const partClass = useElementClass('taskBoard');
  const { canEdit, transport, workspaceId, slots } = useCelune();
  const AiTaskDialog = slots.aiTaskDialog;
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const tasksRef = useRef<Task[]>(initialTasks);
  const setTasksAndRef = useCallback((updater: Task[] | ((prev: Task[]) => Task[])) => {
    setTasks((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      tasksRef.current = next;
      return next;
    });
  }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);
  const [snapshot, setSnapshot] = useState<Task[] | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [skeletonPhase, setSkeletonPhase] = useState<SkeletonPhase | null>(null);
  const [generatedTask, setGeneratedTask] = useState<Task | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTask, setDrawerTask] = useState<Task | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [showDone, setShowDone] = useState(true);
  const [doneFilters, setDoneFilters] = useState<DoneFilters>({
    assignee: 'all',
    priority: 'all',
    search: '',
  });
  const { readIds, markRead } = useReadTasks();
  const dndId = useId();

  // Sync when parent changes the task list (e.g. project filter)
  useEffect(() => {
    setTasksAndRef(initialTasks);
  }, [initialTasks, setTasksAndRef]);

  // Live updates from Supabase via SSE — skip while a drag is in progress
  // to avoid fighting optimistic state mid-drag.
  const { polling, lastSyncedAt } = useTasksRealtime({
    onInsert: useCallback(
      (task: Task) => {
        if (activeId) return;
        setTasksAndRef((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]));
      },
      [activeId, setTasksAndRef],
    ),
    onUpdate: useCallback(
      (task: Task) => {
        if (activeId) return;
        // Detect completion transition for animation + move to top of Done
        const prev = tasksRef.current.find((t) => t.id === task.id);
        const justCompleted = prev && prev.status !== 'done' && task.status === 'done';
        if (justCompleted) {
          setCompletedIds((s) => new Set(s).add(task.id));
          setTimeout(() => {
            setCompletedIds((s) => {
              const next = new Set(s);
              next.delete(task.id);
              return next;
            });
          }, 2000);
        }
        setTasksAndRef((prev) => {
          // Merge metadata defensively: if the incoming SSE payload has
          // a non-null metadata object, spread the existing metadata under it
          // so fields like active_session aren't lost in race conditions
          // between multiple Supabase Realtime events.
          const updated = prev.map((t) => {
            if (t.id !== task.id) return t;
            const mergedMeta =
              task.metadata && t.metadata
                ? { ...t.metadata, ...task.metadata }
                : (task.metadata ?? t.metadata);
            return { ...task, metadata: mergedMeta };
          });
          if (!justCompleted) return updated;
          // Move newly completed task to the top of the Done column
          const without = updated.filter((t) => t.id !== task.id);
          const firstDoneIdx = without.findIndex((t) => t.status === 'done');
          const insertAt = firstDoneIdx >= 0 ? firstDoneIdx : without.length;
          without.splice(insertAt, 0, task);
          return without;
        });
        setDrawerTask((current) => (current?.id === task.id ? task : current));
      },
      [activeId, setTasksAndRef],
    ),
    onDelete: useCallback(
      (id: string) => {
        if (activeId) return;
        setTasksAndRef((prev) => prev.filter((t) => t.id !== id));
        setDrawerTask((current) => (current?.id === id ? null : current));
        setDrawerOpen((open) => {
          if (open && drawerTask?.id === id) return false;
          return open;
        });
      },
      [activeId, drawerTask?.id, setTasksAndRef],
    ),
    workspaceId,
    projectId,
  });

  useImperativeHandle(ref, () => ({
    openNewTask() {
      setDialogOpen(true);
    },
  }));

  /* ── Grab-to-scroll ───────────────────────────────────────── */
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrollDragging = useRef(false);
  const scrollStartX = useRef(0);
  const scrollStartLeft = useRef(0);

  const handleScrollMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Skip if clicking on a card — let dnd-kit handle that
    if ((e.target as HTMLElement).closest('[data-task-card]')) return;
    isScrollDragging.current = true;
    scrollStartX.current = e.clientX;
    scrollStartLeft.current = scrollRef.current?.scrollLeft ?? 0;
  }, []);

  const handleScrollMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isScrollDragging.current) return;
    e.preventDefault();
    const dx = e.clientX - scrollStartX.current;
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollStartLeft.current - dx;
    }
  }, []);

  const stopScrollDrag = useCallback(() => {
    isScrollDragging.current = false;
  }, []);

  /* ── dnd-kit card drag ────────────────────────────────────── */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Custom collision detection: prefer pointer-within for empty columns,
  // fall back to closestCorners for within-column sorting.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      // Prefer task card hits over column droppable hits.
      // When hovering over a card, pointerWithin returns both the card and the
      // column — we want the card so handleDragOver can arrayMove for sorting.
      // The column only wins when hovering over empty column space (no card hit).
      const cardHit = pointerCollisions.find(
        (c) => !(TASK_STATUSES as readonly string[]).includes(c.id as string),
      );
      if (cardHit) return [cardHit];

      const columnHit = pointerCollisions.find((c) =>
        (TASK_STATUSES as readonly string[]).includes(c.id as string),
      );
      if (columnHit) return [columnHit];
      return pointerCollisions;
    }
    return closestCorners(args);
  }, []);

  // Array position IS the display order. initialTasks arrives pre-sorted by
  // sort_order from the server; after that, handleDragOver maintains order
  // via arrayMove so we never need to re-sort during a session.
  const allDoneTasks = useMemo(() => tasks.filter((t) => t.status === 'done'), [tasks]);

  const filteredDoneTasks = useMemo(() => {
    if (!showDone) return [];
    const searchLower = doneFilters.search.trim().toLowerCase();
    return allDoneTasks.filter((t) => {
      // Assignee filter
      if (doneFilters.assignee !== 'all' && t.assignee !== doneFilters.assignee) return false;
      // Priority filter
      if (doneFilters.priority !== 'all' && t.priority !== doneFilters.priority) return false;
      // Title search
      if (searchLower && !t.title.toLowerCase().includes(searchLower)) return false;
      return true;
    });
  }, [allDoneTasks, showDone, doneFilters]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Stable lookup map — avoids passing full tasks array (new ref each render) to children
  const taskLookup = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  const tasksByStatusMap = useMemo(() => {
    const map = {} as Record<TaskStatus, Task[]>;
    for (const status of TASK_STATUSES) {
      if (status === 'done') {
        map[status] = filteredDoneTasks;
        continue;
      }
      map[status] = sortTasksForDisplay(
        tasks.filter((t) => t.status === status),
        sortMode,
        today,
      );
    }
    return map;
  }, [tasks, filteredDoneTasks, sortMode, today]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setOverColumn(null);
    setSnapshot([...tasksRef.current]);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      setTasksAndRef((prev) => {
        const activeTask = prev.find((t) => t.id === active.id);
        if (!activeTask) return prev;

        const overTask = prev.find((t) => t.id === over.id);

        let targetStatus: TaskStatus;
        if (overTask) {
          targetStatus = overTask.status;
        } else if ((TASK_STATUSES as readonly string[]).includes(over.id as string)) {
          targetStatus = over.id as TaskStatus;
        } else {
          return prev;
        }

        // Track which column the dragged card is over (for highlight)
        setOverColumn(targetStatus);

        const activeIdx = prev.findIndex((t) => t.id === active.id);

        if (activeTask.status !== targetStatus) {
          // Cross-column: update status and move to end of target column
          const updated = prev.map((t) =>
            t.id === active.id ? { ...t, status: targetStatus } : t,
          );
          // Splice the moved task to just after the last task in the target column
          const targetEnd = updated.reduce(
            (last, t, i) => (t.status === targetStatus ? i : last),
            activeIdx,
          );
          const result = [...updated];
          const [moved] = result.splice(activeIdx, 1);
          if (!moved) return prev;
          result.splice(targetEnd, 0, moved);
          return result;
        } else if (overTask) {
          // Same-column: reorder in place
          const overIdx = prev.findIndex((t) => t.id === over.id);
          return arrayMove(prev, activeIdx, overIdx);
        }

        return prev;
      });
    },
    [setTasksAndRef],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setOverColumn(null);

      if (!over) {
        if (snapshot) setTasksAndRef(snapshot);
        setSnapshot(null);
        return;
      }

      // Read from ref — always reflects the latest state from handleDragOver,
      // regardless of whether React has re-rendered yet.
      const current = tasksRef.current;
      const activeTask = current.find((t) => t.id === active.id);
      if (!activeTask) {
        setSnapshot(null);
        return;
      }

      const targetStatus = activeTask.status;
      const columnTasks = current.filter((t) => t.status === targetStatus);

      const reorderPayload = columnTasks.map((t, idx) => ({
        id: t.id,
        status: targetStatus,
        sort_order: (idx + 1) * 1000,
      }));

      // Stamp new sort_order values so subsequent drags start from correct base
      setTasksAndRef((prev) =>
        prev.map((t) => {
          const r = reorderPayload.find((p) => p.id === t.id);
          return r ? { ...t, sort_order: r.sort_order } : t;
        }),
      );

      // Auto-switch to manual sort mode when user drags
      onDragReorder?.();

      try {
        await persistTaskReorder(transport, reorderPayload);
      } catch {
        if (snapshot) setTasksAndRef(snapshot);
      }

      setSnapshot(null);
    },
    [snapshot, setTasksAndRef, onDragReorder, transport],
  );

  const activeTask = activeId ? (tasksRef.current.find((t) => t.id === activeId) ?? null) : null;

  // Push task ID into the URL when drawer opens, clear on close
  const pushTaskUrl = useCallback((taskId: string | null) => {
    const url = new URL(window.location.href);
    if (taskId) {
      url.searchParams.set('task', taskId);
    } else {
      url.searchParams.delete('task');
    }
    window.history.replaceState(null, '', url.toString());
  }, []);

  // On mount, auto-open drawer if ?task= is in the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get('task');
    if (!taskId) return;
    const found = tasksRef.current.find((t) => t.id === taskId);
    if (found) {
      markRead(found.id);
      setDrawerTask(found);
      setDrawerOpen(true);
    } else {
      // Task not in loaded list — try fetching directly from API
      setDrawerLoading(true);
      setDrawerOpen(true);
      transport.tasks
        .get(taskId)
        .then((task: Task) => {
          markRead(task.id);
          setDrawerTask(task);
        })
        .catch(() => {
          setDrawerOpen(false);
          // Task doesn't exist — clear the URL param and notify user
          const url = new URL(window.location.href);
          url.searchParams.delete('task');
          window.history.replaceState(null, '', url.toString());
          toast.error('Task not found', {
            description: 'This task may have been deleted or the link is invalid.',
          });
        })
        .finally(() => setDrawerLoading(false));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditTask = (task: Task) => {
    markRead(task.id);
    setDrawerTask(task);
    setDrawerOpen(true);
    pushTaskUrl(task.id);
  };

  const handleSaved = (saved: Task) => {
    setTasksAndRef((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setDialogOpen(false);
    setDrawerTask(saved);
  };

  const handleDeleted = (id: string) => {
    setTasksAndRef((prev) => prev.filter((t) => t.id !== id));
    setDrawerOpen(false);
    setDrawerTask(null);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          'flex h-full flex-col font-(family-name:--celune-font) text-(--celune-fg)',
          partClass,
        )}
      >
        {polling && (
          <div className="flex h-6 shrink-0 items-start justify-end pr-6">
            <SyncStamp at={lastSyncedAt} />
          </div>
        )}
        {loading ? (
          <TaskBoardSkeleton
            columns={TASK_STATUSES.filter((s) => !hiddenStatuses?.has(s)).length}
          />
        ) : tasks.length === 0 ? (
          <TasksEmptyState onCreate={canEdit ? () => setDialogOpen(true) : undefined} />
        ) : (
          <DndContext
            id={dndId}
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div
              ref={scrollRef}
              className="scrollbar-dark scroll-overlay-x flex min-h-0 flex-1 gap-4 pr-6 pb-4 select-none"
              onMouseDown={handleScrollMouseDown}
              onMouseMove={handleScrollMouseMove}
              onMouseUp={stopScrollDrag}
              onMouseLeave={stopScrollDrag}
            >
              {TASK_STATUSES.filter((s) => !hiddenStatuses?.has(s)).map((status, idx, arr) => (
                <TaskColumn
                  key={status}
                  status={status}
                  tasks={tasksByStatusMap[status]}
                  taskLookup={taskLookup}
                  onEditTask={handleEditTask}
                  onAddTask={canEdit ? () => setDialogOpen(true) : undefined}
                  readTaskIds={readIds ?? undefined}
                  completedIds={completedIds}
                  projectNames={projectNames}
                  isDragOver={overColumn === status}
                  sortMode={sortMode}
                  isFirst={idx === 0}
                  isLast={idx === arr.length - 1}
                  today={today}
                  showSprint={showSprint}
                  skeletonCard={
                    status === 'inbox' && skeletonPhase ? (
                      <TaskCardSkeleton
                        phase={skeletonPhase}
                        task={generatedTask}
                        projectName={
                          generatedTask?.project_id
                            ? projectNames[generatedTask.project_id]
                            : undefined
                        }
                        onTransitionEnd={() => {
                          if (generatedTask) handleSaved(generatedTask);
                          setSkeletonPhase(null);
                          setGeneratedTask(null);
                        }}
                      />
                    ) : undefined
                  }
                  customHeader={
                    status === 'done' ? (
                      <DoneFilterToggle
                        showDone={showDone}
                        onToggle={setShowDone}
                        totalCount={allDoneTasks.length}
                        filteredCount={filteredDoneTasks.length}
                        filters={doneFilters}
                        onFiltersChange={setDoneFilters}
                      />
                    ) : undefined
                  }
                />
              ))}
            </div>

            <DragOverlay>
              {activeTask ? (
                <TaskCard task={activeTask} isDragOverlay showSprint={showSprint} />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {AiTaskDialog ? (
          <AiTaskDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            projectId={projectId}
            onGenerating={() => {
              setSkeletonPhase('generating');
              setGeneratedTask(null);
            }}
            onGenerated={(task) => {
              setGeneratedTask(task);
              setSkeletonPhase('success');
              setTimeout(() => setSkeletonPhase('reveal'), 800);
            }}
            onError={() => {
              setSkeletonPhase(null);
              setGeneratedTask(null);
            }}
          />
        ) : (
          <TaskDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            projectId={projectId}
            onSaved={(task) => {
              handleSaved(task);
              setDialogOpen(false);
            }}
          />
        )}

        <TaskDrawer
          open={drawerOpen}
          loading={drawerLoading}
          task={drawerTask}
          taskLookup={taskLookup}
          onClose={() => {
            setDrawerOpen(false);
            setDrawerTask(null);
            pushTaskUrl(null);
          }}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      </div>
    </TooltipProvider>
  );
});

export { TaskBoardComponent as TaskBoard };
