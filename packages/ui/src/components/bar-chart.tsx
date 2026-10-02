'use client';

import * as React from 'react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { cn } from '../utils';
import { ChartCard, ChartHeader, ChartContent, ChartFooter, ChartTooltip } from './chart';
import type { ChartConfig } from './chart';

// ──────────────────────────────────────────────────────────────────────────────
// BarChartCard
// ──────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataPoint = any;

interface BarChartCardProps {
  data: DataPoint[];
  /** Primary data key to render. Can also be an array of keys for grouped bars. */
  dataKey: string | string[];
  config: ChartConfig;
  title?: React.ReactNode;
  metric?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  /** The key used for the category axis label */
  categoryKey?: string;
  layout?: 'horizontal' | 'vertical';
  showGrid?: boolean;
  showYAxis?: boolean;
  showXAxis?: boolean;
  /** Height of the chart area in px */
  height?: number;
  /** recharts syncId for linked tooltips */
  syncId?: string;
  isLoading?: boolean;
  isDisabled?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  /** Per-bar fill from data point key (e.g. "color") */
  colorKey?: string;
  className?: string;
}

function BarChartCard({
  data,
  dataKey,
  config,
  title,
  metric,
  action,
  footer,
  categoryKey = 'name',
  layout = 'horizontal',
  showGrid = false,
  showYAxis = true,
  showXAxis = true,
  height = 224,
  syncId,
  isLoading = false,
  isDisabled = false,
  isEmpty,
  emptyMessage,
  colorKey,
  className,
}: BarChartCardProps) {
  const isVertical = layout === 'horizontal'; // recharts: horizontal layout = vertical bars
  const keys = Array.isArray(dataKey) ? dataKey : [dataKey];

  const barRadius = (key: string, index: number): [number, number, number, number] => {
    // Only round the last key in a grouped bar to avoid gaps
    const isLast = index === keys.length - 1;
    if (!isLast) return [0, 0, 0, 0];
    return isVertical ? [4, 4, 0, 0] : [0, 4, 4, 0];
  };

  const resolvedIsEmpty = isEmpty ?? (!isLoading && data.length === 0);

  return (
    <ChartCard isLoading={isLoading} isDisabled={isDisabled} config={config} className={className}>
      {(title || metric || action) && <ChartHeader title={title} metric={metric} action={action} />}

      <ChartContent height={height} isEmpty={resolvedIsEmpty} emptyMessage={emptyMessage}>
        <ResponsiveContainer width="100%" height="100%">
          <RechartsBarChart
            data={data}
            layout={layout}
            syncId={syncId}
            margin={{ top: 4, right: 4, bottom: 4, left: 0 }}
          >
            {showGrid && (
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-default)"
                vertical={!isVertical}
                horizontal={isVertical}
              />
            )}

            {/* Category axis */}
            {isVertical
              ? showXAxis && (
                  <XAxis
                    dataKey={categoryKey}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--foreground-lighter)', fontSize: 11 }}
                  />
                )
              : showXAxis && (
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--foreground-lighter)', fontSize: 11 }}
                  />
                )}

            {/* Value axis */}
            {isVertical
              ? showYAxis && (
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--foreground-lighter)', fontSize: 11 }}
                    width={30}
                  />
                )
              : showYAxis && (
                  <YAxis
                    type="category"
                    dataKey={categoryKey}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--foreground-lighter)', fontSize: 11 }}
                    width={72}
                  />
                )}

            <ChartTooltip />

            {keys.map((key, i) => {
              const cfgEntry = config[key];
              const fill = cfgEntry?.color ?? 'var(--brand-default)';

              return (
                <Bar
                  key={key}
                  dataKey={key}
                  name={cfgEntry?.label ?? key}
                  fill={fill}
                  radius={barRadius(key, i)}
                >
                  {colorKey &&
                    data.map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill={(entry[colorKey] as string) ?? fill} />
                    ))}
                </Bar>
              );
            })}
          </RechartsBarChart>
        </ResponsiveContainer>
      </ChartContent>

      {footer && <ChartFooter>{footer}</ChartFooter>}
    </ChartCard>
  );
}

export { BarChartCard };
export type { BarChartCardProps };
