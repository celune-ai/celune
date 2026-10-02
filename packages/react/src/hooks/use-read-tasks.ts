'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'read-tasks';

function loadReadIds(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return new Set(stored ? (JSON.parse(stored) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage errors
  }
}

/**
 * Tasks this browser has opened. `readIds` is null until the stored set loads after mount,
 * so server and first client render agree; nothing shows as unread until then.
 */
export function useReadTasks() {
  const [readIds, setReadIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    setReadIds(loadReadIds());
  }, []);

  const markRead = (id: string) => {
    setReadIds((prev) => {
      const base = prev ?? loadReadIds();
      if (base.has(id)) return base;
      const next = new Set(base);
      next.add(id);
      saveReadIds(next);
      return next;
    });
  };

  const isUnread = (id: string) => readIds !== null && !readIds.has(id);

  return { readIds, markRead, isUnread };
}
