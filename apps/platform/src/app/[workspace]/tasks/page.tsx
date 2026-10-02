'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  ArrowUpDown,
  GitBranch,
  Clock,
  Layers,
  ChevronDown,
  LayoutGrid,
  List,
  Save,
  Search,
  X,
  EyeOff,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Popover, PopoverTrigger, PopoverContent } from '@repo/ui/components/popover';
import { Checkbox } from '@repo/ui/components/checkbox';
import { TaskBoard, type TaskBoardHandle } from '@celuneai/react/tasks';
import { TaskListView, type TaskListViewHandle } from '@celuneai/react/tasks';
import { PageActionBar } from '@/components/page-action-bar';
import { ErrorState } from '@/components/error-state';
import { useViewPreferences } from '@/hooks/use-view-preferences';
import { useTableColumns } from '@celuneai/react/hooks';
import { PermissionGate } from '@/components/permission-gate';
import type { TaskSortMode } from '@celuneai/react/utils';
import { TASK_STATUSES, TASK_STATUS_LABELS } from '@repo/types';
import type { TaskStatus } from '@repo/types';
import { useTasksQuery } from '@celuneai/react/hooks';
import { useProjectsQuery } from '@celuneai/react/hooks';

const HIDDEN_SECTIONS_KEY = 'celune:hidden-sections';

function useHiddenSections() {
  const [hidden, setHiddenState] = useState<Set<TaskStatus>>(() => new Set());

  // Loaded after mount so the first client render matches the server.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HIDDEN_SECTIONS_KEY);
      if (stored) setHiddenState(new Set(JSON.parse(stored) as TaskStatus[]));
    } catch {
      // storage unavailable
    }
  }, []);

  const setHidden = useCallback((next: Set<TaskStatus>) => {
    setHiddenState(next);
    try {
      localStorage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify([...next]));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const toggle = useCallback(
    (status: TaskStatus) => {
      const next = new Set(hidden);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      setHidden(next);
    },
    [hidden, setHidden],
  );

  return { hidden, toggle };
}

const SORT_MODES: { value: TaskSortMode; label: string; icon: typeof ArrowUpDown }[] = [
  { value: 'sequence', label: 'Sequence', icon: GitBranch },
  { value: 'manual', label: 'Manual', icon: ArrowUpDown },
  { value: 'recency', label: 'Recency', icon: Clock },
];

export default function TasksPage() {
  const {
    data: tasks = [],
    isLoading: tasksLoading,
    error: tasksError,
    refetch: refetchTasks,
  } = useTasksQuery();
  const { data: projects = [], isLoading: projectsLoading } = useProjectsQuery();
  const loading = tasksLoading || projectsLoading;
  const error = tasksError
    ? tasksError instanceof Error
      ? tasksError.message
      : 'Failed to load tasks'
    : null;

  const {
    viewMode,
    sortMode,
    showSprint,
    handleViewChange,
    handleSortChange,
    handleDragReorder,
    handleSprintToggle,
  } = useViewPreferences();
  const {
    columns,
    isDirty: columnsDirty,
    save: saveColumns,
    updateColumnWidth,
    reorderColumns,
    gridTemplate,
    minWidth,
  } = useTableColumns();
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [showCompletedProjects, setShowCompletedProjects] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { hidden: hiddenSections, toggle: toggleSection } = useHiddenSections();
  const viewRef = useRef<TaskBoardHandle & TaskListViewHandle>(null);

  const projectNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of projects) map[p.id] = p.name;
    return map;
  }, [projects]);

  const projectsWithCounts = useMemo(
    () =>
      projects.map((p) => {
        const projectTasks = tasks.filter((t) => t.project_id === p.id);
        const done = projectTasks.filter((t) => t.status === 'done').length;
        return { ...p, taskCount: projectTasks.length, doneCount: done };
      }),
    [projects, tasks],
  );

  const visibleProjects = showCompletedProjects
    ? projectsWithCounts
    : projectsWithCounts.filter((p) => p.taskCount === 0 || p.doneCount < p.taskCount);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filterProjectId) result = result.filter((t) => t.project_id === filterProjectId);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(q));
    }
    return result;
  }, [tasks, filterProjectId, searchQuery]);

  const selectedProjectName = filterProjectId ? projectNames[filterProjectId] : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageActionBar>
        <span className="text-foreground text-xl font-medium">Tasks</span>
        <PermissionGate permission="tasks:create" mode="hide">
          <Button size="md" variant="default" onClick={() => viewRef.current?.openNewTask()}>
            <Plus className="mr-1 h-4 w-4" />
            Add task
          </Button>
        </PermissionGate>
      </PageActionBar>

      {/* Filter row */}
      <div className="flex items-center justify-between px-6 pt-4 pb-0">
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="border-border text-foreground hover:bg-surface-100 flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors"
              >
                {selectedProjectName ?? 'Projects'}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
              <div className="border-border flex items-center gap-2 border-b px-3 py-2">
                <Checkbox
                  id="show-completed"
                  checked={showCompletedProjects}
                  onCheckedChange={(checked) => setShowCompletedProjects(checked === true)}
                />
                <label
                  htmlFor="show-completed"
                  className="text-muted-foreground text-xs select-none"
                >
                  Show completed projects
                </label>
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                <button
                  type="button"
                  onClick={() => setFilterProjectId(null)}
                  className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                    filterProjectId === null
                      ? 'bg-surface-200 text-foreground'
                      : 'text-muted-foreground hover:bg-surface-100 hover:text-foreground'
                  }`}
                >
                  All Projects
                </button>
                {visibleProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setFilterProjectId(p.id)}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      filterProjectId === p.id
                        ? 'bg-surface-200 text-foreground'
                        : 'text-muted-foreground hover:bg-surface-100 hover:text-foreground'
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-muted-foreground ml-2 shrink-0 tabular-nums">
                      {p.doneCount}/{p.taskCount}
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Search */}
          <div className="border-border focus-within:ring-ring flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs focus-within:ring-1">
            <Search className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            <input
              type="text"
              placeholder="Search tasks…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-foreground placeholder:text-muted-foreground w-24 bg-transparent text-xs font-medium outline-none sm:w-36"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Board / List toggle */}
          <div className="border-border flex items-center rounded-md border">
            <button
              type="button"
              onClick={() => handleViewChange('board')}
              title="Board view"
              className={`flex cursor-pointer items-center gap-1.5 rounded-l-[5px] px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === 'board'
                  ? 'bg-surface-200 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleViewChange('list')}
              title="List view"
              className={`flex cursor-pointer items-center gap-1.5 rounded-r-[5px] px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === 'list'
                  ? 'bg-surface-200 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
              }`}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="border-border flex items-center rounded-md border">
            {SORT_MODES.map((m, idx) => {
              const Icon = m.icon;
              const active = sortMode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => handleSortChange(m.value)}
                  title={`Sort: ${m.label}`}
                  className={`flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-surface-200 text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
                  } ${idx === 0 ? 'rounded-l-[5px]' : ''} ${idx === SORT_MODES.length - 1 ? 'rounded-r-[5px]' : ''}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleSprintToggle}
            title="Toggle sprint labels"
            className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              showSprint
                ? 'border-border bg-surface-200 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-surface-100'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
          </button>

          {/* Hide Sections */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Hide sections"
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  hiddenSections.size > 0
                    ? 'border-border bg-surface-200 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-surface-100'
                }`}
              >
                <EyeOff className="h-3.5 w-3.5" />
                {hiddenSections.size > 0 && (
                  <span className="tabular-nums">{hiddenSections.size}</span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              {TASK_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleSection(status)}
                  className="hover:bg-surface-100 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                >
                  <Checkbox
                    checked={!hiddenSections.has(status)}
                    onCheckedChange={() => toggleSection(status)}
                  />
                  <span
                    className={
                      hiddenSections.has(status) ? 'text-muted-foreground' : 'text-foreground'
                    }
                  >
                    {TASK_STATUS_LABELS[status]}
                  </span>
                </button>
              ))}
            </PopoverContent>
          </Popover>

          {/* Save table layout — only visible when column order/widths changed */}
          {viewMode === 'list' && columnsDirty && (
            <button
              type="button"
              onClick={saveColumns}
              title="Save table layout"
              className="flex cursor-pointer items-center justify-center rounded-md bg-green-600 p-1.5 text-white transition-colors hover:bg-green-500"
            >
              <Save className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className={`min-h-0 flex-1 overflow-hidden pt-4 ${viewMode === 'board' ? 'pl-6' : ''}`}>
        {error ? (
          <ErrorState message={error} onRetry={() => void refetchTasks()} />
        ) : viewMode === 'board' ? (
          <TaskBoard
            ref={viewRef}
            initialTasks={filteredTasks}
            loading={loading}
            projectNames={projectNames}
            sortMode={sortMode}
            showSprint={showSprint}
            onDragReorder={handleDragReorder}
            hiddenStatuses={hiddenSections}
          />
        ) : (
          <TaskListView
            ref={viewRef}
            initialTasks={filteredTasks}
            loading={loading}
            projectNames={projectNames}
            sortMode={sortMode}
            showSprint={showSprint}
            onDragReorder={handleDragReorder}
            columns={columns}
            gridTemplate={gridTemplate}
            minWidth={minWidth}
            onColumnResize={updateColumnWidth}
            onColumnReorder={reorderColumns}
          />
        )}
      </div>
    </div>
  );
}
