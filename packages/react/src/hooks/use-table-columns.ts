'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type ColumnId = 'name' | 'status' | 'priority' | 'assignee' | 'effort' | 'due';

export interface TableColumn {
  id: ColumnId;
  label: string;
  width: number;
  minWidth: number;
}

export const DEFAULT_COLUMNS: TableColumn[] = [
  { id: 'name', label: 'Name', width: 300, minWidth: 150 },
  { id: 'status', label: 'Status', width: 130, minWidth: 90 },
  { id: 'priority', label: 'Priority', width: 110, minWidth: 80 },
  { id: 'assignee', label: 'Assignee', width: 150, minWidth: 100 },
  { id: 'effort', label: 'Effort', width: 100, minWidth: 70 },
  { id: 'due', label: 'Due date', width: 100, minWidth: 70 },
];

const STORAGE_KEY = 'task-table-columns';

function loadColumns(): TableColumn[] {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as TableColumn[];
      if (
        Array.isArray(parsed) &&
        parsed.length === DEFAULT_COLUMNS.length &&
        parsed.every((c) => c.id && typeof c.width === 'number')
      ) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_COLUMNS;
}

export function buildGridTemplate(columns: TableColumn[]): string {
  return `20px ${columns.map((c, i) => (i === 0 ? `minmax(${c.width}px, 1fr)` : `${c.width}px`)).join(' ')}`;
}

export function buildMinWidth(columns: TableColumn[]): string {
  return `${20 + columns.reduce((sum, c) => sum + c.width, 0)}px`;
}

export function useTableColumns() {
  const [columns, setColumns] = useState<TableColumn[]>(DEFAULT_COLUMNS);
  const [savedColumns, setSavedColumns] = useState<TableColumn[]>(DEFAULT_COLUMNS);

  useEffect(() => {
    const loaded = loadColumns();
    setColumns(loaded);
    setSavedColumns(loaded);
  }, []);

  const isDirty = useMemo(() => {
    return JSON.stringify(columns) !== JSON.stringify(savedColumns);
  }, [columns, savedColumns]);

  const save = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
    } catch {
      // Storage full or unavailable — skip persistence
    }
    setSavedColumns([...columns]);
  }, [columns]);

  const updateColumnWidth = useCallback((id: ColumnId, width: number) => {
    setColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, width: Math.max(c.minWidth, width) } : c)),
    );
  }, []);

  const reorderColumns = useCallback((fromIndex: number, toIndex: number) => {
    // Name column (index 0) is pinned — never move it or drop onto it
    if (fromIndex === 0 || toIndex === 0) return;
    setColumns((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return prev;
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const gridTemplate = useMemo(() => buildGridTemplate(columns), [columns]);
  const minWidth = useMemo(() => buildMinWidth(columns), [columns]);

  return {
    columns,
    isDirty,
    save,
    updateColumnWidth,
    reorderColumns,
    gridTemplate,
    minWidth,
  };
}
