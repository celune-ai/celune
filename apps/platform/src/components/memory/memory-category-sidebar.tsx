'use client';

import {
  Brain,
  Settings,
  GitBranch,
  Info,
  BookOpen,
  ArrowRightLeft,
  Activity,
  Tag,
  Layers,
} from 'lucide-react';
import { cn } from '@repo/ui/utils';
import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CategoryCount {
  category: string;
  count: number;
  /** true when the category was created by an agent rather than being a system default */
  isCustom?: boolean;
}

export interface HeartbeatSummary {
  type: 'daily' | 'weekly' | 'monthly' | 'custom';
  label: string;
  /** ISO date string of last run */
  lastRun?: string;
  count: number;
}

export interface MemoryCategorySidebarProps {
  categories: CategoryCount[];
  activeCategory: string | null;
  onCategorySelect: (cat: string | null) => void;
  heartbeats?: HeartbeatSummary[];
}

/* ------------------------------------------------------------------ */
/*  Icon mapping                                                       */
/* ------------------------------------------------------------------ */

const SYSTEM_CATEGORY_ICONS: Record<string, LucideIcon> = {
  general: Brain,
  preference: Settings,
  decision: GitBranch,
  context: Info,
  fact: BookOpen,
  handoff: ArrowRightLeft,
};

function iconForCategory(category: string, isCustom?: boolean): LucideIcon {
  if (isCustom) return Tag;
  return SYSTEM_CATEGORY_ICONS[category.toLowerCase()] ?? Brain;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MemoryCategorySidebar({
  categories,
  activeCategory,
  onCategorySelect,
  heartbeats,
}: MemoryCategorySidebarProps) {
  const totalCount = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <aside className="border-border bg-surface-75 flex w-60 shrink-0 flex-col overflow-y-auto border-r">
      {/* ---- Categories section ---- */}
      <div className="px-3 pt-4 pb-2">
        <ul className="space-y-0.5" role="listbox" aria-label="Memory categories">
          {/* All Memories */}
          <li role="option" aria-selected={activeCategory === null}>
            <button
              type="button"
              onClick={() => onCategorySelect(null)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                activeCategory === null
                  ? 'bg-brand/10 text-brand font-medium'
                  : 'text-foreground-lighter hover:bg-surface-100 hover:text-foreground',
              )}
            >
              <Layers className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">All Memories</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs tabular-nums',
                  activeCategory === null
                    ? 'bg-brand/20 text-brand'
                    : 'bg-surface-200 text-foreground-lighter',
                )}
              >
                {totalCount}
              </span>
            </button>
          </li>

          {/* Individual categories */}
          {categories.map((cat) => {
            const isActive = activeCategory === cat.category;
            const Icon = iconForCategory(cat.category, cat.isCustom);

            return (
              <li key={cat.category} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => onCategorySelect(cat.category)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-brand/10 text-brand font-medium'
                      : 'text-foreground-lighter hover:bg-surface-100 hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left capitalize">
                    {cat.isCustom && (
                      <span className="bg-brand mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" />
                    )}
                    {cat.category}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs tabular-nums',
                      isActive
                        ? 'bg-brand/20 text-brand'
                        : 'bg-surface-200 text-foreground-lighter',
                    )}
                  >
                    {cat.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ---- Heartbeats section ---- */}
      {heartbeats && heartbeats.length > 0 && (
        <div className="border-border mt-2 border-t px-3 pt-4 pb-4">
          <h3 className="text-foreground-lighter mb-2 flex items-center gap-2 px-2 text-xs font-medium tracking-wider uppercase">
            <Activity className="h-3.5 w-3.5" />
            Heartbeats
          </h3>

          <ul className="space-y-0.5" aria-label="Heartbeat digests">
            {heartbeats.map((hb) => (
              <li
                key={`${hb.type}-${hb.label}`}
                className="text-foreground-lighter hover:bg-surface-100 hover:text-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
              >
                <Activity className="text-brand h-4 w-4 shrink-0 animate-pulse" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate">{hb.label}</span>
                  {hb.lastRun && (
                    <span className="text-foreground-muted block text-xs">
                      {formatRelativeDate(hb.lastRun)}
                    </span>
                  )}
                </div>
                <span className="bg-surface-200 text-foreground-lighter rounded-full px-2 py-0.5 text-xs tabular-nums">
                  {hb.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
