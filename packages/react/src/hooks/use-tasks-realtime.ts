'use client';

import { useEffect, useRef, useState } from 'react';
import type { Task } from '@repo/types';
import { useCelune } from '../provider/context';

interface Handlers {
  onInsert: (task: Task) => void;
  onUpdate: (task: Task) => void;
  onDelete: (id: string) => void;
  /** Only receive events for tasks in this workspace. Defaults to the provider workspace. */
  workspaceId?: string;
  /** Narrows the polling fallback to one project. */
  projectId?: string;
}

const POLL_PAGE_SIZE = 500;

/**
 * Live task changes. Uses the provider's `subscribe` adapter when present,
 * otherwise polls the transport and diffs snapshots at `pollInterval`.
 * Handlers live in a ref so inline callbacks do not resubscribe.
 * Returns whether it is polling and when the last poll succeeded, for an "Updated Ns ago" stamp.
 */
export function useTasksRealtime({
  onInsert,
  onUpdate,
  onDelete,
  workspaceId,
  projectId,
}: Handlers) {
  const { subscribe, transport, pollInterval, workspaceId: providerWorkspaceId } = useCelune();
  const wsId = workspaceId ?? providerWorkspaceId;
  const handlersRef = useRef({ onInsert, onUpdate, onDelete });
  handlersRef.current = { onInsert, onUpdate, onDelete };
  const polling = !subscribe && pollInterval > 0;
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!subscribe) return;
    return subscribe(
      { table: 'tasks', filter: wsId ? { column: 'workspace_id', value: wsId } : undefined },
      (change) => {
        const row = change.new as unknown as Task | null;
        if (change.type === 'INSERT' && row) {
          // Kanban shows top-level tasks only
          if (row.parent_id != null) return;
          handlersRef.current.onInsert(row);
        } else if (change.type === 'UPDATE' && row) {
          handlersRef.current.onUpdate(row);
        } else if (change.type === 'DELETE' && change.old?.id) {
          handlersRef.current.onDelete(change.old.id as string);
        }
      },
    );
  }, [subscribe, wsId]);

  useEffect(() => {
    if (subscribe || pollInterval <= 0) return;
    let snapshot: Map<string, Task> | null = null;
    let cancelled = false;

    const poll = async () => {
      let rows: Task[];
      try {
        rows = await transport.tasks.list({ projectId, pageSize: POLL_PAGE_SIZE });
      } catch {
        return;
      }
      if (cancelled) return;
      setLastSyncedAt(Date.now());
      const next = new Map(rows.map((t) => [t.id, t]));
      if (snapshot) {
        for (const [id, task] of next) {
          const prev = snapshot.get(id);
          if (!prev) {
            if (task.parent_id == null) handlersRef.current.onInsert(task);
          } else if (prev.updated_at !== task.updated_at) {
            handlersRef.current.onUpdate(task);
          }
        }
        // A full page may be truncated, so deletions are only trusted below the limit.
        if (rows.length < POLL_PAGE_SIZE) {
          for (const id of snapshot.keys()) {
            if (!next.has(id)) handlersRef.current.onDelete(id);
          }
        }
      }
      snapshot = next;
    };

    void poll();
    const timer = setInterval(poll, pollInterval);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [subscribe, transport, pollInterval, projectId, wsId]);

  return { polling, lastSyncedAt: polling ? lastSyncedAt : null };
}
