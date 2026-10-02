'use client';

import { useMemo } from 'react';

interface HeatmapRow {
  label: string;
  color: string;
  values: number[];
}

interface HeatmapCardProps {
  title: string;
  rows: HeatmapRow[];
  columnLabels: string[];
  loading?: boolean;
  /** Cell size: 'sm' (default, 28px), 'lg' (84px), or 'xl' (120px) */
  cellSize?: 'sm' | 'lg' | 'xl';
}

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="bg-surface-300 mb-3 h-4 w-32 rounded" />
      <div className="bg-surface-200 h-40 w-full rounded" />
    </div>
  );
}

export function HeatmapCard({
  title,
  rows,
  columnLabels,
  loading,
  cellSize = 'sm',
}: HeatmapCardProps) {
  const isLg = cellSize === 'lg' || cellSize === 'xl';
  const isXl = cellSize === 'xl';
  const maxValue = useMemo(() => {
    let m = 0;
    for (const row of rows) {
      for (const v of row.values) {
        if (v > m) m = v;
      }
    }
    return m || 1;
  }, [rows]);

  if (loading) {
    return (
      <div className="border-border bg-surface-75 rounded-lg border p-4">
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="border-border bg-surface-75 rounded-lg border p-4">
      <h3 className="text-foreground mb-3 text-sm font-medium">{title}</h3>
      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-1"
          style={{
            gridTemplateColumns: `${isXl ? '140px' : isLg ? '120px' : '100px'} repeat(${columnLabels.length}, ${isXl ? 'minmax(120px, 1fr)' : isLg ? 'minmax(80px, 1fr)' : '1fr'})`,
          }}
        >
          {/* Column headers */}
          <div />
          {columnLabels.map((col) => (
            <div
              key={col}
              className="text-foreground-lighter px-1 text-center text-[10px] font-medium"
            >
              {col}
            </div>
          ))}

          {/* Rows */}
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <div className="flex items-center gap-1.5 pr-2">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="text-foreground-light truncate text-[11px]">{row.label}</span>
              </div>
              {row.values.map((v, i) => {
                const intensity = v / maxValue;
                return (
                  <div
                    key={i}
                    className={`group relative flex items-center justify-center rounded ${isXl ? 'h-[120px] min-w-[120px]' : isLg ? 'h-[84px] min-w-[80px]' : 'h-7 min-w-[2rem]'}`}
                    aria-label={`${row.label}, ${columnLabels[i] ?? ''}: ${v}`}
                    style={{
                      backgroundColor:
                        intensity > 0
                          ? `color-mix(in srgb, ${row.color} ${Math.round(intensity * 60 + 10)}%, transparent)`
                          : 'var(--color-surface-200)',
                    }}
                  >
                    <span
                      className={`text-foreground-lighter tabular-nums ${isXl ? 'text-base font-semibold' : isLg ? 'text-sm font-medium' : 'text-[10px]'}`}
                    >
                      {v > 0 ? v : ''}
                    </span>
                    <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 rounded bg-black/80 px-2 py-1 text-[10px] whitespace-nowrap text-white group-hover:block">
                      {row.label} &middot; {columnLabels[i]} &middot; {v}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
