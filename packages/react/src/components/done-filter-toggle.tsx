'use client';

import { Eye, EyeOff } from 'lucide-react';

export interface DoneFilters {
  assignee: string;
  priority: string;
  search: string;
}

interface DoneFilterToggleProps {
  showDone: boolean;
  onToggle: (show: boolean) => void;
  totalCount: number;
  filteredCount: number;
  filters: DoneFilters;
  onFiltersChange: (filters: DoneFilters) => void;
}

export function DoneFilterToggle({
  showDone,
  onToggle,
  totalCount,
  filteredCount,
}: DoneFilterToggleProps) {
  return (
    <div className="flex w-full items-center gap-2.5">
      <button
        type="button"
        onClick={() => onToggle(!showDone)}
        className="flex items-center gap-[6px] font-(weight:--celune-font-weight-strong) text-(--celune-fg) transition-colors hover:text-(--celune-fg)/80"
        style={{ fontSize: 'var(--celune-text-base)' }}
      >
        Done
        {showDone ? (
          <EyeOff className="h-3.5 w-3.5 text-(--celune-fg-muted)" />
        ) : (
          <Eye className="h-3.5 w-3.5 text-(--celune-fg-muted)" />
        )}
      </button>

      <span
        className={`text-xs leading-none tabular-nums ${
          filteredCount > 0
            ? 'rounded-[4px] bg-(--celune-status-done)/10 px-1.5 py-0.5 text-(--celune-status-done)'
            : 'rounded-[4px] bg-(--celune-surface-hover) px-1.5 py-0.5 text-(--celune-fg-muted)'
        }`}
      >
        {filteredCount}
      </span>
    </div>
  );
}
