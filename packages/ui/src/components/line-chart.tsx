'use client';

import * as React from 'react';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Area,
  AreaChart as RechartsAreaChart,
} from 'recharts';
import { ChartCard, ChartHeader, ChartContent, ChartFooter, ChartTooltip } from './chart';
import type { ChartConfig } from './chart';

// ──────────────────────────────────────────────────────────────────────────────
// LineChartCard
// ──────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataPoint = any;

interface LineChartCardProps {
  data: DataPoint[];
  /** Primary data key(s) to render as lines */
  dataKey: string | string[];
  config: ChartConfig;
  title?: React.ReactNode;
  metric?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  /** The key used for the x-axis label */
  categoryKey?: string;
  showGrid?: boolean;
  showYAxis?: boolean;
  showXAxis?: boolean;
  /** Show area fill with gradient under the line */
  showArea?: boolean;
  /** Show dots on data points (always visible) — hover dots are always shown */
  showDots?: boolean;
  height?: number;
  syncId?: string;
  isLoading?: boolean;
  isDisabled?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  className?: string;
}

function LineChartCard({
  data,
  dataKey,
  config,
  title,
  metric,
  action,
  footer,
  categoryKey = 'name',
  showGrid = false,
  showYAxis = true,
  showXAxis = true,
  showArea = false,
  showDots = false,
  height = 224,
  syncId,
  isLoading = false,
  isDisabled = false,
  isEmpty,
  emptyMessage,
  className,
}: LineChartCardProps) {
  const keys = Array.isArray(dataKey) ? dataKey : [dataKey];
  const resolvedIsEmpty = isEmpty ?? (!isLoading && data.length === 0);

  const commonAxisProps = {
    axisLine: false as const,
    tickLine: false as const,
    tick: { fill: 'var(--foreground-lighter)', fontSize: 11 } as React.SVGProps<SVGTextElement>,
  };

  const sharedMargin = { top: 4, right: 4, bottom: 4, left: 0 };

  const renderLines = (gradientIds: string[]) =>
    keys.map((key, i) => {
      const cfgEntry = config[key];
      const stroke = cfgEntry?.color ?? 'var(--brand-default)';

      if (showArea) {
        return (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            name={cfgEntry?.label ?? key}
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientIds[i]})`}
            dot={showDots ? { r: 3, strokeWidth: 0, fill: stroke } : false}
            activeDot={{ r: 4, strokeWidth: 0, fill: stroke }}
          />
        );
      }

      return (
        <Line
          key={key}
          type="monotone"
          dataKey={key}
          name={cfgEntry?.label ?? key}
          stroke={stroke}
          strokeWidth={2}
          dot={showDots ? { r: 3, strokeWidth: 0, fill: stroke } : false}
          activeDot={{ r: 4, strokeWidth: 0, fill: stroke }}
        />
      );
    });

  const gradientIds = keys.map((_, i) => `line-gradient-${i}`);

  const chartContent = (
    <ResponsiveContainer width="100%" height="100%">
      {showArea ? (
        <RechartsAreaChart data={data} syncId={syncId} margin={sharedMargin}>
          <defs>
            {keys.map((key, i) => {
              const cfgEntry = config[key];
              const color = cfgEntry?.color ?? 'var(--brand-default)';
              return (
                <linearGradient key={key} id={gradientIds[i]} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              );
            })}
          </defs>
          {showGrid && (
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
          )}
          {showXAxis && <XAxis dataKey={categoryKey} {...commonAxisProps} />}
          {showYAxis && <YAxis allowDecimals={false} {...commonAxisProps} width={30} />}
          <ChartTooltip />
          {renderLines(gradientIds)}
        </RechartsAreaChart>
      ) : (
        <RechartsLineChart data={data} syncId={syncId} margin={sharedMargin}>
          {showGrid && (
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
          )}
          {showXAxis && <XAxis dataKey={categoryKey} {...commonAxisProps} />}
          {showYAxis && <YAxis allowDecimals={false} {...commonAxisProps} width={30} />}
          <ChartTooltip />
          {renderLines(gradientIds)}
        </RechartsLineChart>
      )}
    </ResponsiveContainer>
  );

  return (
    <ChartCard isLoading={isLoading} isDisabled={isDisabled} config={config} className={className}>
      {(title || metric || action) && <ChartHeader title={title} metric={metric} action={action} />}

      <ChartContent height={height} isEmpty={resolvedIsEmpty} emptyMessage={emptyMessage}>
        {chartContent}
      </ChartContent>

      {footer && <ChartFooter>{footer}</ChartFooter>}
    </ChartCard>
  );
}

export { LineChartCard };
export type { LineChartCardProps };
