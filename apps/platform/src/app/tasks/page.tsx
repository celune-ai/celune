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
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Popover, PopoverTrigger, PopoverContent } from '@repo/ui/components/popover';
import { Checkbox } from '@repo/ui/components/checkbox';
import { TaskBoard, type TaskBoardHandle } from '@celuneai/react/tasks';
import { TaskListView, type TaskListViewHandle } from '@celuneai/react/tasks';
import { PageActionBar } from '@/components/page-action-bar';
import { ErrorState } from '@/components/error-state';
import { useViewPreferences } from '@/hooks/use-view-preferences';
import type { Task, Project } from '@repo/types';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import type { TaskSortMode } from '@celuneai/react/utils';

const SORT_MODES: { value: TaskSortMode; label: string; icon: typeof ArrowUpDown }[] = [
  { value: 'manual', label: 'Manual', icon: ArrowUpDown },
  { value: 'sequence', label: 'Sequence', icon: GitBranch },
  { value: 'recency', label: 'Recency', icon: Clock },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    viewMode,
    sortMode,
    showSprint,
    handleViewChange,
    handleSortChange,
    handleDragReorder,
    handleSprintToggle,
  } = useViewPreferences();
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [showCompletedProjects, setShowCompletedProjects] = useState(false);
  const viewRef = useRef<TaskBoardHandle & TaskListViewHandle>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchJson<Task[]>(apiUrl('/api/tasks')),
      fetchJson<Project[]>(apiUrl('/api/projects')),
    ])
      .then(([fetchedTasks, fetchedProjects]: [Task[], Project[]]) => {
        setTasks(fetchedTasks);
        setProjects(fetchedProjects);
        const map: Record<string, string> = {};
        for (const p of fetchedProjects) map[p.id] = p.name;
        setProjectNames(map);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load tasks';
        setError(message);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const projectsWithCounts = useMemo(() => {
    const tasksByProject = new Map<string, { total: number; done: number }>();
    for (const t of tasks) {
      if (!t.project_id) continue;
      const entry = tasksByProject.get(t.project_id) ?? { total: 0, done: 0 };
      entry.total++;
      if (t.status === 'done') entry.done++;
      tasksByProject.set(t.project_id, entry);
    }
    return projects.map((p) => {
      const counts = tasksByProject.get(p.id) ?? { total: 0, done: 0 };
      return { ...p, taskCount: counts.total, doneCount: counts.done };
    });
  }, [projects, tasks]);

  const visibleProjects = showCompletedProjects
    ? projectsWithCounts
    : projectsWithCounts.filter((p) => p.taskCount === 0 || p.doneCount < p.taskCount);

  const filteredTasks = filterProjectId
    ? tasks.filter((t) => t.project_id === filterProjectId)
    : tasks;

  const selectedProjectName = filterProjectId ? projectNames[filterProjectId] : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageActionBar>
        <span className="text-foreground text-xl font-medium">Tasks</span>
        <Button size="md" variant="default" onClick={() => viewRef.current?.openNewTask()}>
          <Plus className="mr-1 h-4 w-4" />
          Add task
        </Button>
      </PageActionBar>

      {/* Filter row */}
      <div className="flex items-center justify-between px-6 py-4">
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
              <label htmlFor="show-completed" className="text-muted-foreground text-xs select-none">
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
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {error ? (
          <ErrorState message={error} onRetry={fetchData} />
        ) : viewMode === 'board' ? (
          <TaskBoard
            ref={viewRef}
            initialTasks={filteredTasks}
            loading={loading}
            projectNames={projectNames}
            sortMode={sortMode}
            showSprint={showSprint}
            onDragReorder={handleDragReorder}
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
          />
        )}
      </div>
    </div>
  );
}
