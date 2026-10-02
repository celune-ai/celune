'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TaskSortMode } from '@celuneai/react/utils';

export type ViewMode = 'board' | 'list';

// Server-safe defaults (must match SSR output)
const DEFAULT_VIEW: ViewMode = 'board';
const DEFAULT_SORT: TaskSortMode = 'sequence';
const DEFAULT_SPRINT = false;

function readView(): ViewMode {
  const stored = localStorage.getItem('task-view-mode');
  return stored === 'board' || stored === 'list' ? stored : DEFAULT_VIEW;
}

function readSort(): TaskSortMode {
  const stored = localStorage.getItem('task-sort-mode');
  return stored === 'priority' ||
    stored === 'sequence' ||
    stored === 'manual' ||
    stored === 'recency'
    ? stored
    : DEFAULT_SORT;
}

export function useViewPreferences() {
  const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_VIEW);
  const [sortMode, setSortMode] = useState<TaskSortMode>(DEFAULT_SORT);
  const [showSprint, setShowSprint] = useState(DEFAULT_SPRINT);

  // Stored preferences load after mount so the first client render matches the server.
  useEffect(() => {
    try {
      setViewMode(readView());
      setSortMode(readSort());
      setShowSprint(localStorage.getItem('task-show-sprint') === 'true');
    } catch {
      // storage unavailable: keep defaults
    }
  }, []);

  const handleViewChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('task-view-mode', mode);
  }, []);

  const handleSortChange = useCallback((mode: TaskSortMode) => {
    setSortMode(mode);
    localStorage.setItem('task-sort-mode', mode);
  }, []);

  const handleDragReorder = useCallback(() => {
    setSortMode('manual');
    localStorage.setItem('task-sort-mode', 'manual');
  }, []);

  const handleSprintToggle = useCallback(() => {
    setShowSprint((prev) => {
      const next = !prev;
      localStorage.setItem('task-show-sprint', String(next));
      return next;
    });
  }, []);

  return {
    viewMode,
    sortMode,
    showSprint,
    handleViewChange,
    handleSortChange,
    handleDragReorder,
    handleSprintToggle,
  } as const;
}
