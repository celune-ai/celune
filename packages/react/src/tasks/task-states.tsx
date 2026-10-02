'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { cn } from '@repo/ui/utils';
import { ROW_HEIGHT_ESTIMATE } from './task-list-sections';

const BAR = 'animate-pulse motion-reduce:animate-none rounded bg-(--celune-surface-hover)';

/** Card placeholder sized to TaskCard: title line, then a badge row. */
function CardSkeleton({ wide }: { wide?: boolean }) {
  return (
    <div className="space-y-3 rounded border border-(--celune-border) bg-(--celune-surface) p-5">
      <div className="flex h-6 items-center">
        <div className={cn(BAR, 'h-3.5', wide ? 'w-4/5' : 'w-3/5')} />
      </div>
      <div className="flex h-6 items-center gap-1.5">
        <div className={cn(BAR, 'h-5 w-14')} />
        <div className={cn(BAR, 'h-5 w-10')} />
      </div>
    </div>
  );
}

const CARDS_PER_COLUMN = [3, 2, 2, 1, 2, 1, 2];

/** Board loading state: columns and cards at their real widths, no spinner. */
export function TaskBoardSkeleton({ columns = 7 }: { columns?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading tasks"
      className="flex min-h-0 flex-1 gap-4 overflow-hidden pr-6 pb-4"
    >
      {Array.from({ length: columns }).map((_, col) => (
        <div
          key={col}
          className="flex w-[300px] min-w-[300px] shrink-0 flex-col"
          style={{ marginLeft: col === 0 ? '24px' : undefined }}
        >
          <div
            className="flex h-[52px] items-center gap-2.5 rounded"
            style={{
              backgroundColor: 'var(--celune-surface-muted)',
              marginBottom: '8px',
              paddingLeft: '10px',
              paddingRight: '10px',
            }}
          >
            <div className={cn(BAR, 'h-4 w-20')} />
            <div className={cn(BAR, 'h-4 w-5')} />
          </div>
          <div
            className="flex flex-col gap-2 rounded py-2 pr-1 pl-2"
            style={{ backgroundColor: 'var(--celune-surface-muted)' }}
          >
            {Array.from({ length: CARDS_PER_COLUMN[col % CARDS_PER_COLUMN.length] ?? 1 }).map(
              (__, i) => (
                <CardSkeleton key={i} wide={(col + i) % 2 === 0} />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const LIST_ROWS = [0.55, 0.4, 0.7, 0.35, 0.6, 0.45, 0.5, 0.65];

/** List loading state: header and rows at the real row height. */
export function TaskListSkeleton({ rows = LIST_ROWS.length }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading tasks"
      className="min-h-0 flex-1 overflow-hidden pb-6"
    >
      <div className="ml-6 flex items-center gap-6 border-b border-(--celune-border-strong) py-3 pl-8">
        {[24, 16, 16, 20, 12, 16].map((w, i) => (
          <div key={i} className={BAR} style={{ height: 12, width: w * 4 }} />
        ))}
      </div>
      <div className="ml-6 flex items-center gap-2 py-3 pl-3">
        <div className={cn(BAR, 'h-4 w-24')} />
        <div className={cn(BAR, 'h-4 w-5')} />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="ml-6 flex items-center gap-6 border-b border-(--celune-border) pl-8"
          style={{ height: ROW_HEIGHT_ESTIMATE }}
        >
          <div
            className={cn(BAR, 'h-3.5')}
            style={{ width: `${(LIST_ROWS[i % LIST_ROWS.length] ?? 0.5) * 40}%` }}
          />
          <div className={cn(BAR, 'ml-auto h-5 w-16')} />
          <div className={cn(BAR, 'h-5 w-14')} />
          <div className={cn(BAR, 'mr-6 h-5 w-16')} />
        </div>
      ))}
    </div>
  );
}

/** Drawer body while a task loads: title row, the two-column meta grid, and section headings. */
export function TaskDrawerSkeleton({ closeButton }: { closeButton?: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading task" className="flex flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex-1 space-y-2.5 pt-1">
          <div className={cn(BAR, 'h-6 w-3/5')} />
          <div className={cn(BAR, 'h-3 w-16')} />
        </div>
        {closeButton}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex h-9 items-center gap-3">
            <div className={cn(BAR, 'h-3.5 w-[96px] shrink-0')} />
            <div className={cn(BAR, 'h-9 flex-1')} />
          </div>
        ))}
      </div>
      <div className="px-5 pb-5">
        <div className="flex h-9 items-center gap-3">
          <div className={cn(BAR, 'h-3.5 w-[96px] shrink-0')} />
          <div className={cn(BAR, 'h-9 flex-1')} />
        </div>
      </div>
      <div className="px-5">
        {[true, false, false].map((open, i) => (
          <div key={i} className="space-y-3 border-t border-(--celune-border) py-5">
            <div className={cn(BAR, 'h-3.5 w-24')} />
            {open && (
              <>
                <div className={cn(BAR, 'h-3 w-11/12')} />
                <div className={cn(BAR, 'h-3 w-1/2')} />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Whole-view empty state: one sentence, and one action when the viewer can create tasks. */
export function TasksEmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-16">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <p className="text-(length:--celune-text-base) text-(--celune-fg-muted)">
          No tasks here yet.
        </p>
        {onCreate && (
          <Button
            size="md"
            className="h-9 gap-1.5 text-sm font-(weight:--celune-font-weight-strong)"
            onClick={onCreate}
          >
            <Plus className="h-4 w-4" />
            Create task
          </Button>
        )}
      </div>
    </div>
  );
}

export function formatSyncAge(seconds: number): string {
  if (seconds < 60) return `Updated ${seconds}s ago`;
  if (seconds < 3600) return `Updated ${Math.floor(seconds / 60)}m ago`;
  return `Updated ${Math.floor(seconds / 3600)}h ago`;
}

/**
 * Quiet "Updated Ns ago" stamp for polling mode. The clock starts after mount, so server and
 * first client render both show nothing.
 */
export function SyncStamp({ at }: { at: number | null }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (at === null || now === null) return null;
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return (
    <span
      className="text-(length:--celune-text-2xs) text-(--celune-fg-muted) tabular-nums"
      aria-live="off"
    >
      {formatSyncAge(seconds)}
    </span>
  );
}
