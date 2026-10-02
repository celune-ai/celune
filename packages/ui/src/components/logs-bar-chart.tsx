'use client';

import * as React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import { cn } from '../utils';
import { Skeleton } from './skeleton';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface LogsDataPoint {
  timestamp: string;
  ok_count: number;
  error_count: number;
  warning_count: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Status colors — fixed semantic values for ok/error/warning
// ──────────────────────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  ok: '#34B27B',
  warning: '#F59E0B',
  error: '#F04438',
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// Custom tooltip
// ──────────────────────────────────────────────────────────────────────────────

interface LogsTooltipContentProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; fill: string }>;
  label?: string;
}

function LogsTooltipContent({ active, payload, label }: LogsTooltipContentProps) {
  if (!active || !payload?.length) return null;

  const total = payload.reduce((sum, p) => sum + (p.value ?? 0), 0);
  if (total === 0) return null;

  return (
    <div className="bg-surface-200 border-border rounded-lg border p-2.5 shadow-lg">
      {label && <p className="text-foreground-lighter mb-1.5 text-[11px] font-medium">{label}</p>}
      <div className="flex flex-col gap-1">
        {payload
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.name} className="flex items-center gap-1.5 text-[11px]">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ background: p.fill }}
              />
              <span className="text-foreground-lighter capitalize">
                {p.name.replace('_count', '')}:
              </span>
              <span className="text-foreground font-medium">{p.value.toLocaleString()}</span>
            </div>
          ))}
        <div className="border-border mt-1 border-t pt-1">
          <div className="flex items-center justify-between gap-4 text-[11px]">
            <span className="text-foreground-lighter">Total</span>
            <span className="text-foreground font-medium">{total.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// LogsBarChart
// ──────────────────────────────────────────────────────────────────────────────

interface LogsBarChartProps {
  data: LogsDataPoint[];
  height?: number;
  isLoading?: boolean;
  showTimestamps?: boolean;
  className?: string;
}

function LogsBarChart({
  data,
  height = 96,
  isLoading = false,
  showTimestamps = false,
  className,
}: LogsBarChartProps) {
  if (isLoading) {
    return <Skeleton style={{ height }} className={cn('w-full rounded-md', className)} />;
  }

  if (!data.length) {
    return (
      <div
        style={{ height }}
        className={cn('text-foreground-muted flex items-center justify-center text-xs', className)}
      >
        No log data
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="20%"
        >
          {showTimestamps && (
            <XAxis
              dataKey="timestamp"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--foreground-lighter)', fontSize: 10 }}
              tickFormatter={(v: string) => {
                try {
                  return new Date(v).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                } catch {
                  return v;
                }
              }}
            />
          )}

          <RechartsTooltip
            content={(props: TooltipProps<ValueType, NameType>) => (
              <LogsTooltipContent
                active={props.active}
                payload={
                  (props.payload ?? []) as Array<{ name: string; value: number; fill: string }>
                }
                label={(() => {
                  try {
                    return new Date(String(props.label ?? '')).toLocaleString();
                  } catch {
                    return String(props.label ?? '');
                  }
                })()}
              />
            )}
            cursor={{ fill: 'var(--background-surface-300)', opacity: 0.5 }}
          />

          {/* Render ok first (bottom of stack), then warning, then error (top) */}
          <Bar
            dataKey="ok_count"
            name="ok_count"
            stackId="logs"
            fill={STATUS_COLORS.ok}
            radius={[0, 0, 2, 2]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="warning_count"
            name="warning_count"
            stackId="logs"
            fill={STATUS_COLORS.warning}
            radius={[0, 0, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="error_count"
            name="error_count"
            stackId="logs"
            fill={STATUS_COLORS.error}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export { LogsBarChart };
export type { LogsBarChartProps };
