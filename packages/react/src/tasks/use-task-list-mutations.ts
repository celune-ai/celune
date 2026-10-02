'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import { TASK_STATUSES } from '@repo/types';
import type { Task, TaskStatus } from '@repo/types';
import { useReadTasks } from '../hooks/use-read-tasks';
import { useTasksRealtime } from '../hooks/use-tasks-realtime';
import { persistTaskReorder } from '../lib/reorder';
import { useCelune } from '../provider/context';

export interface TaskListMutationsOptions {
  initialTasks: Task[];
  projectId?: string;
  onDragReorder?: () => void;
}

/**
 * State and writes behind the list view: realtime merges, drag reorder
 * persistence, deep-link loading, and drawer save/delete handling.
 */
export function useTaskListMutations({
  initialTasks,
  projectId,
  onDragReorder,
}: TaskListMutationsOptions) {
  const { transport, workspaceId } = useCelune();
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
  const [snapshot, setSnapshot] = useState<Task[] | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTask, setDrawerTask] = useState<Task | null>(null);
  const { readIds, markRead } = useReadTasks();

  // Sync when parent changes the task list (e.g. project filter)
  useEffect(() => {
    setTasksAndRef(initialTasks);
  }, [initialTasks, setTasksAndRef]);

  // Realtime SSE — skip while dragging
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
          const updated = prev.map((t) => {
            if (t.id !== task.id) return t;
            const mergedMeta =
              task.metadata && t.metadata
                ? { ...t.metadata, ...task.metadata }
                : (task.metadata ?? t.metadata);
            return { ...task, metadata: mergedMeta };
          });
          if (!justCompleted) return updated;
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

  // dnd-kit
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
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
        } else {
          const overId = over.id as string;
          const headerStatus = overId.match(/^header-(.+)$/)?.[1];
          if (headerStatus && (TASK_STATUSES as readonly string[]).includes(headerStatus)) {
            targetStatus = headerStatus as TaskStatus;
          } else if ((TASK_STATUSES as readonly string[]).includes(overId)) {
            targetStatus = overId as TaskStatus;
          } else {
            return prev;
          }
        }

        const activeIdx = prev.findIndex((t) => t.id === active.id);

        if (activeTask.status !== targetStatus) {
          const updated = prev.map((t) =>
            t.id === active.id ? { ...t, status: targetStatus } : t,
          );
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

      if (!over) {
        if (snapshot) setTasksAndRef(snapshot);
        setSnapshot(null);
        return;
      }

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

      setTasksAndRef((prev) =>
        prev.map((t) => {
          const r = reorderPayload.find((p) => p.id === t.id);
          return r ? { ...t, sort_order: r.sort_order } : t;
        }),
      );

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

  // URL sync
  const pushTaskUrl = useCallback((taskId: string | null) => {
    const url = new URL(window.location.href);
    if (taskId) {
      url.searchParams.set('task', taskId);
    } else {
      url.searchParams.delete('task');
    }
    window.history.replaceState(null, '', url.toString());
  }, []);

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
      transport.tasks
        .get(taskId)
        .then((task: Task) => {
          markRead(task.id);
          setDrawerTask(task);
          setDrawerOpen(true);
        })
        .catch(() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('task');
          window.history.replaceState(null, '', url.toString());
          toast.error('Task not found', {
            description: 'This task may have been deleted or the link is invalid.',
          });
        });
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

  return {
    tasks,
    tasksRef,
    setTasksAndRef,
    activeId,
    activeTask,
    completedIds,
    dialogOpen,
    setDialogOpen,
    drawerOpen,
    setDrawerOpen,
    drawerTask,
    setDrawerTask,
    readIds,
    markRead,
    polling,
    lastSyncedAt,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    pushTaskUrl,
    handleEditTask,
    handleSaved,
    handleDeleted,
  };
}
