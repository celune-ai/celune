'use client';

import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Three-panel layout skeleton (loading state)
// ---------------------------------------------------------------------------

export function MemoryLayoutSkeleton() {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_280px]">
      {/* Sidebar skeleton */}
      <div className="border-border hidden border-r p-4 lg:block">
        <div className="bg-surface-200 mb-4 h-5 w-24 animate-pulse rounded" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface-200 h-8 animate-pulse rounded" />
          ))}
        </div>
      </div>
      {/* Content skeleton */}
      <div className="space-y-3 p-6">
        <div className="bg-surface-200 h-10 w-full animate-pulse rounded-lg" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-border bg-surface-75 rounded-lg border p-4">
            <div className="bg-surface-200 mb-2 h-4 w-3/4 animate-pulse rounded" />
            <div className="bg-surface-200 h-3 w-1/4 animate-pulse rounded" />
          </div>
        ))}
      </div>
      {/* Insights skeleton */}
      <div className="border-border hidden border-l p-4 xl:block">
        <div className="bg-surface-200 mb-4 h-5 w-20 animate-pulse rounded" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface-200 h-16 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memory Layout
// ---------------------------------------------------------------------------

interface MemoryLayoutProps {
  sidebar: ReactNode;
  content: ReactNode;
  insights?: ReactNode;
}

export function MemoryLayout({ sidebar, content, insights }: MemoryLayoutProps) {
  return (
    <div className="flex min-h-full flex-col">
      {/* Three-panel grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_280px]">
        {/* Left sidebar */}
        <aside
          className="border-border hidden animate-[memoryPanelIn_300ms_ease-out_both] border-r lg:block"
          style={{ '--tw-translate-x-from': '-16px' } as React.CSSProperties}
        >
          {sidebar}
        </aside>

        {/* Center content */}
        <main className="min-w-0 animate-[memoryFadeIn_300ms_ease-out_both]">{content}</main>

        {/* Right insights panel */}
        {insights && (
          <aside
            className="border-border hidden animate-[memoryPanelIn_300ms_ease-out_150ms_both] border-l xl:block"
            style={{ '--tw-translate-x-from': '16px' } as React.CSSProperties}
          >
            {insights}
          </aside>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memory Detail Layout — no sidebar, content + metadata panel
// ---------------------------------------------------------------------------

interface MemoryDetailLayoutProps {
  content: ReactNode;
  metadata: ReactNode;
}

export function MemoryDetailLayout({ content, metadata }: MemoryDetailLayoutProps) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[1fr_280px]">
        {/* Content */}
        <main className="min-w-0 animate-[memoryFadeIn_300ms_ease-out_both]">{content}</main>

        {/* Metadata sidebar */}
        <aside
          className="border-border hidden animate-[memoryPanelIn_300ms_ease-out_150ms_both] border-l xl:block"
          style={{ '--tw-translate-x-from': '16px' } as React.CSSProperties}
        >
          {metadata}
        </aside>
      </div>
    </div>
  );
}
