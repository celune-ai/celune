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
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TooltipProvider } from '@repo/ui/components/tooltip';
import { TaskRow } from './task-row';
import { TaskRowHeader } from './task-row-header';
import { AddTaskRow } from './add-task-row';
import { TaskDialog } from './task-dialog';
import { TaskDrawer } from './task-drawer';
import { DoneFilterToggle, type DoneFilters } from '../components/done-filter-toggle';
import { TASK_STATUSES } from '@repo/types';
import type { Task, TaskStatus } from '@repo/types';
import { sortTasksForDisplay, countOverdue, type TaskSortMode } from '../lib/task-sort';
import { useCelune } from '../provider/context';
import { useTaskListMutations } from './use-task-list-mutations';
import {
  VIRTUALIZE_THRESHOLD,
  ROW_HEIGHT_ESTIMATE,
  VirtualizedStatusSection,
  loadCollapsed,
  groupTasksBySprint,
  SprintSectionHeader,
} from './task-list-sections';
import { cn } from '@repo/ui/utils';
import {
  type ColumnId,
  type TableColumn,
  DEFAULT_COLUMNS,
  buildGridTemplate,
  buildMinWidth,
} from '../hooks/use-table-columns';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useElementClass } from '../provider/appearance';
import { SyncStamp, TaskListSkeleton, TasksEmptyState } from './task-states';

interface TaskListViewProps {
  initialTasks: Task[];
  projectId?: string;
  projectNames?: Record<string, string>;
  sortMode?: TaskSortMode;
  showSprint?: boolean;
  onDragReorder?: () => void;
  columns?: TableColumn[];
  gridTemplate?: string;
  minWidth?: string;
  onColumnResize?: (id: ColumnId, width: number) => void;
  onColumnReorder?: (fromIndex: number, toIndex: number) => void;
  /** Shows skeleton rows in place of the list while the host loads tasks. */
  loading?: boolean;
}

export interface TaskListViewHandle {
  openNewTask: () => void;
}

const TaskListViewComponent = forwardRef<TaskListViewHandle, TaskListViewProps>(
  function TaskListView(
    {
      initialTasks,
      projectId,
      projectNames = {},
      sortMode = 'manual',
      showSprint,
      onDragReorder,
      loading = false,
      columns = DEFAULT_COLUMNS,
      gridTemplate: gridTemplateProp,
      minWidth: minWidthProp,
      onColumnResize,
      onColumnReorder,
    },
    ref,
  ) {
    const { canEdit, slots } = useCelune();
    const partClass = useElementClass('taskList');
    const AiTaskDialog = slots.aiTaskDialog;
    const {
      tasks,
      activeTask,
      completedIds,
      dialogOpen,
      setDialogOpen,
      drawerOpen,
      setDrawerOpen,
      drawerTask,
      setDrawerTask,
      readIds,
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
    } = useTaskListMutations({ initialTasks, projectId, onDragReorder });
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    useEffect(() => setCollapsed(loadCollapsed()), []);
    const dndId = useId();
    const [skeletonVisible, setSkeletonVisible] = useState(false);
    const [showDone, setShowDone] = useState(true);
    const [doneFilters, setDoneFilters] = useState<DoneFilters>({
      assignee: 'all',
      priority: 'all',
      search: '',
    });

    // Column drag reorder state (HTML5 drag and drop)
    const dragColIdx = useRef<number | null>(null);
    const [dragOverColIdx, setDragOverColIdx] = useState<number | null>(null);

    // Column resize state
    const resizeRef = useRef<{ colId: ColumnId; startX: number; startWidth: number } | null>(null);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const resolvedGrid = gridTemplateProp ?? buildGridTemplate(columns);
    const resolvedMinWidth = minWidthProp ?? buildMinWidth(columns);

    // Resize mouse handlers (throttled via rAF to avoid excessive re-renders)
    const rafRef = useRef<number | null>(null);
    const handleResizeStart = useCallback(
      (e: React.MouseEvent, colId: ColumnId, currentWidth: number) => {
        e.preventDefault();
        e.stopPropagation();
        resizeRef.current = { colId, startX: e.clientX, startWidth: currentWidth };

        const handleMouseMove = (ev: MouseEvent) => {
          if (!resizeRef.current) return;
          if (rafRef.current !== null) return; // skip if a frame is already scheduled
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            if (!resizeRef.current) return;
            const delta = ev.clientX - resizeRef.current.startX;
            onColumnResize?.(resizeRef.current.colId, resizeRef.current.startWidth + delta);
          });
        };

        const handleMouseUp = () => {
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          resizeRef.current = null;
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      },
      [onColumnResize],
    );

    useImperativeHandle(ref, () => ({
      openNewTask() {
        setDialogOpen(true);
      },
    }));

    // Collapse toggle
    const toggleCollapse = (status: TaskStatus) => {
      setCollapsed((prev) => {
        const next = { ...prev, [status]: !prev[status] };
        try {
          localStorage.setItem('task-list-collapsed', JSON.stringify(next));
        } catch {
          // Storage full or unavailable — skip persistence
        }
        return next;
      });
    };

    // Task grouping
    const allDoneTasks = useMemo(() => tasks.filter((t) => t.status === 'done'), [tasks]);

    const filteredDoneTasks = useMemo(() => {
      if (!showDone) return [];
      const searchLower = doneFilters.search.trim().toLowerCase();
      return allDoneTasks.filter((t) => {
        if (doneFilters.assignee !== 'all' && t.assignee !== doneFilters.assignee) return false;
        if (doneFilters.priority !== 'all' && t.priority !== doneFilters.priority) return false;
        if (searchLower && !t.title.toLowerCase().includes(searchLower)) return false;
        return true;
      });
    }, [allDoneTasks, showDone, doneFilters]);

    const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

    const taskLookup = useMemo(() => {
      const map = new Map<string, Task>();
      for (const t of tasks) map.set(t.id, t);
      return map;
    }, [tasks]);

    const tasksByStatus = useCallback(
      (status: TaskStatus) => {
        if (status === 'done') return filteredDoneTasks;
        const col = tasks.filter((t) => t.status === status);
        return sortTasksForDisplay(col, sortMode, today);
      },
      [tasks, filteredDoneTasks, sortMode, today],
    );

    // Sprint grouping — active when showSprint is on and we're in a project context
    const sprintGroupingActive = !!showSprint && !!projectId;
    const sprintGroups = useMemo(
      () => (sprintGroupingActive ? groupTasksBySprint(tasks) : []),
      [sprintGroupingActive, tasks],
    );

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
            <TaskListSkeleton />
          ) : tasks.length === 0 ? (
            <TasksEmptyState onCreate={canEdit ? () => setDialogOpen(true) : undefined} />
          ) : (
            <DndContext
              id={dndId}
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <div
                ref={scrollContainerRef}
                className="scrollbar-dark relative min-h-0 flex-1 overflow-x-auto overflow-y-auto pb-6"
              >
                <div style={{ minWidth: resolvedMinWidth }}>
                  {/* Column headers */}
                  <div
                    className="sticky top-0 z-10 ml-6 grid items-center border-b border-(--celune-border-strong) bg-(--celune-bg) text-xs font-(weight:--celune-font-weight-medium) text-(--celune-fg-muted)"
                    style={{ gridTemplateColumns: resolvedGrid }}
                  >
                    {/* Dynamic column headers — draggable and resizable */}
                    {columns.map((col, i) => {
                      const isName = col.id === 'name';
                      const isDraggable = !isName && !!onColumnReorder;
                      return (
                        <div
                          key={col.id}
                          style={isName ? { gridColumn: '1 / 3' } : undefined}
                          draggable={isDraggable}
                          onDragStart={(e) => {
                            if (!isDraggable) return;
                            dragColIdx.current = i;
                            e.dataTransfer.effectAllowed = 'move';
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.opacity = '0.6';
                            el.style.position = 'absolute';
                            el.style.top = '-1000px';
                            document.body.appendChild(el);
                            e.dataTransfer.setDragImage(el, 0, 0);
                            // Remove after the browser captures the drag image (next frame)
                            requestAnimationFrame(() => {
                              if (el.parentNode) el.parentNode.removeChild(el);
                            });
                          }}
                          onDragOver={(e) => {
                            if (isName || !onColumnReorder) return;
                            e.preventDefault();
                            setDragOverColIdx(i);
                          }}
                          onDragLeave={() => setDragOverColIdx(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (
                              !isName &&
                              onColumnReorder &&
                              dragColIdx.current !== null &&
                              dragColIdx.current !== i
                            ) {
                              onColumnReorder(dragColIdx.current, i);
                            }
                            dragColIdx.current = null;
                            setDragOverColIdx(null);
                          }}
                          onDragEnd={() => {
                            dragColIdx.current = null;
                            setDragOverColIdx(null);
                          }}
                          className={cn(
                            'relative flex items-center self-stretch py-3 select-none',
                            isDraggable && 'cursor-grab',
                            i > 0 && 'border-l border-(--celune-border-strong)',
                            isName && 'pr-3 pl-8',
                            !isName && 'pl-3',
                            dragOverColIdx === i && 'bg-(--celune-primary)/10',
                          )}
                        >
                          {col.label}

                          {/* Resize handle — centered on column divider, full-height green line on hover */}
                          {onColumnResize && (
                            <div
                              className="group/resize absolute top-0 -right-[5px] z-20 h-[200vh] w-[10px] cursor-col-resize"
                              onMouseDown={(e) => handleResizeStart(e, col.id, col.width)}
                            >
                              <div className="absolute top-0 bottom-0 left-1/2 w-[2px] -translate-x-1/2 bg-(--celune-primary)/60 opacity-0 transition-opacity group-hover/resize:opacity-100" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Sprint-grouped sections (when sprint toggle is active on project page) */}
                  {sprintGroupingActive &&
                    sprintGroups.map((group) => {
                      const key = `sprint-${group.sprint}`;
                      const isCollapsed = !!collapsed[key];

                      return (
                        <div key={key} className="mt-1">
                          <SprintSectionHeader
                            group={group}
                            collapsed={isCollapsed}
                            onToggle={() => {
                              setCollapsed((prev) => {
                                const next = { ...prev, [key]: !prev[key] };
                                try {
                                  localStorage.setItem('task-list-collapsed', JSON.stringify(next));
                                } catch {
                                  /* skip */
                                }
                                return next;
                              });
                            }}
                          />
                          {!isCollapsed && (
                            <SortableContext
                              items={group.tasks.map((t) => t.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              <div className="ml-6 border-t border-(--celune-border-strong)">
                                {group.tasks.map((task) => (
                                  <TaskRow
                                    key={task.id}
                                    task={task}
                                    onEdit={handleEditTask}
                                    taskLookup={taskLookup}
                                    isUnread={!!readIds && !readIds.has(task.id)}
                                    isJustCompleted={completedIds.has(task.id)}
                                    showSprint={false}
                                    sortMode={sortMode}
                                    columns={columns}
                                    gridTemplate={resolvedGrid}
                                  />
                                ))}
                              </div>
                            </SortableContext>
                          )}
                        </div>
                      );
                    })}

                  {/* Status sections (default grouping) */}
                  {!sprintGroupingActive &&
                    TASK_STATUSES.map((status) => {
                      const statusTasks = tasksByStatus(status);
                      const isCollapsed = !!collapsed[status];
                      const overdueCount = status !== 'done' ? countOverdue(statusTasks, today) : 0;

                      return (
                        <div key={status} className="mt-1">
                          <TaskRowHeader
                            status={status}
                            count={statusTasks.length}
                            overdueCount={overdueCount}
                            collapsed={isCollapsed}
                            onToggle={() => toggleCollapse(status)}
                            onAddTask={canEdit ? () => setDialogOpen(true) : undefined}
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
                          {!isCollapsed &&
                          status === 'done' &&
                          statusTasks.length > VIRTUALIZE_THRESHOLD ? (
                            <VirtualizedStatusSection
                              status={status}
                              tasks={statusTasks}
                              scrollContainerRef={scrollContainerRef}
                              onEdit={handleEditTask}
                              taskLookup={taskLookup}
                              readIds={readIds}
                              completedIds={completedIds}
                              projectNames={projectNames}
                              showSprint={showSprint}
                              sortMode={sortMode}
                              columns={columns}
                              gridTemplate={resolvedGrid}
                              canEdit={canEdit}
                              projectId={projectId}
                            />
                          ) : (
                            !isCollapsed && (
                              <SortableContext
                                items={statusTasks.map((t) => t.id)}
                                strategy={verticalListSortingStrategy}
                              >
                                <div className="ml-6 border-t border-(--celune-border-strong)">
                                  {statusTasks.map((task) => (
                                    <TaskRow
                                      key={task.id}
                                      task={task}
                                      onEdit={handleEditTask}
                                      taskLookup={taskLookup}
                                      isUnread={!!readIds && !readIds.has(task.id)}
                                      isJustCompleted={completedIds.has(task.id)}
                                      projectName={
                                        task.project_id ? projectNames[task.project_id] : undefined
                                      }
                                      showSprint={showSprint}
                                      sortMode={sortMode}
                                      columns={columns}
                                      gridTemplate={resolvedGrid}
                                    />
                                  ))}
                                  {status === 'inbox' && skeletonVisible && (
                                    <div
                                      className="grid items-center border-b border-(--celune-border-strong)"
                                      style={{
                                        gridTemplateColumns: resolvedGrid,
                                        height: ROW_HEIGHT_ESTIMATE,
                                      }}
                                    >
                                      <div className="flex items-center justify-center self-stretch py-1 pl-3">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-(--celune-primary)" />
                                      </div>
                                      {columns.map((col, i) => (
                                        <div
                                          key={col.id}
                                          className={cn(
                                            'flex items-center self-stretch py-1',
                                            i > 0 && 'border-l border-(--celune-border-strong)',
                                            col.id === 'name' ? 'gap-2 pl-3' : 'pl-3',
                                          )}
                                        >
                                          <div
                                            className={cn(
                                              'animate-pulse rounded bg-(--celune-surface-hover) motion-reduce:animate-none',
                                              col.id === 'name' ? 'h-3.5 w-3/5' : 'h-5 w-14',
                                            )}
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {canEdit && (
                                    <AddTaskRow
                                      status={status}
                                      projectId={projectId}
                                      columns={columns}
                                      gridTemplate={resolvedGrid}
                                    />
                                  )}
                                </div>
                              </SortableContext>
                            )
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              <DragOverlay>
                {activeTask ? (
                  <TaskRow
                    task={activeTask}
                    isDragOverlay
                    showSprint={showSprint}
                    sortMode={sortMode}
                    columns={columns}
                    gridTemplate={resolvedGrid}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          )}

          {AiTaskDialog ? (
            <AiTaskDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              projectId={projectId}
              onGenerating={() => setSkeletonVisible(true)}
              onGenerated={(task) => {
                setSkeletonVisible(false);
                handleSaved(task);
              }}
              onError={() => setSkeletonVisible(false)}
            />
          ) : (
            <TaskDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              projectId={projectId}
              onSaved={handleSaved}
            />
          )}

          <TaskDrawer
            open={drawerOpen}
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
  },
);

export { TaskListViewComponent as TaskListView };
