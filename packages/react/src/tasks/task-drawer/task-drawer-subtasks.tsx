'use client';

import { cn } from '@repo/ui/utils';
import type { Subtask } from '@repo/types';

interface TaskDrawerSubtasksProps {
  subtasks: Subtask[];
}

export function TaskDrawerSubtasks({ subtasks }: TaskDrawerSubtasksProps) {
  if (subtasks.length === 0) return null;

  const completed = subtasks.filter((s) => s.done).length;
  const total = subtasks.length;

  return (
    <div className="space-y-1.5 px-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-(weight:--celune-font-weight-medium) tracking-wide text-(--celune-fg-muted) uppercase">
          Subtasks
        </p>
        <span className="text-xs text-(--celune-fg-muted)">
          {completed}/{total}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-(--celune-surface-muted)">
        <div
          className="h-1 rounded-full bg-(--celune-status-done) transition-all"
          style={{ width: `${(completed / total) * 100}%` }}
        />
      </div>
      <div className="mt-2 space-y-1.5">
        {subtasks.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div
              role="checkbox"
              aria-checked={s.done}
              aria-label={s.title}
              className={cn(
                'h-3.5 w-3.5 shrink-0 rounded-sm border border-(--celune-border)',
                s.done && 'border-(--celune-status-done) bg-(--celune-status-done)',
              )}
            />
            <span className={cn(s.done && 'text-(--celune-fg-muted) line-through')}>{s.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
