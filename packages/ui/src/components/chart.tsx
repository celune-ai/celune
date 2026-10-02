'use client';

import * as React from 'react';
import { Tooltip as RechartsTooltip, type TooltipProps } from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import { cn } from '../utils';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from './card';
import { Skeleton } from './skeleton';

// ──────────────────────────────────────────────────────────────────────────────
// ChartConfig type
// ──────────────────────────────────────────────────────────────────────────────

export type ChartConfig = Record<
  string,
  {
    label: string;
    color?: string;
    theme?: Record<'light' | 'dark', string>;
  }
>;

// ──────────────────────────────────────────────────────────────────────────────
// Context
// ──────────────────────────────────────────────────────────────────────────────

interface ChartContextValue {
  isLoading: boolean;
  isDisabled: boolean;
  config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextValue>({
  isLoading: false,
  isDisabled: false,
  config: {},
});

export function useChart() {
  return React.useContext(ChartContext);
}

// ──────────────────────────────────────────────────────────────────────────────
// Chart (root provider — standalone, no Card wrapper)
// ──────────────────────────────────────────────────────────────────────────────

interface ChartProps extends React.HTMLAttributes<HTMLDivElement> {
  isLoading?: boolean;
  isDisabled?: boolean;
  config?: ChartConfig;
}

const Chart = React.forwardRef<HTMLDivElement, ChartProps>(
  ({ isLoading = false, isDisabled = false, config = {}, className, children, ...props }, ref) => (
    <ChartContext.Provider value={{ isLoading, isDisabled, config }}>
      <div ref={ref} className={cn('relative', className)} {...props}>
        {children}
      </div>
    </ChartContext.Provider>
  ),
);
Chart.displayName = 'Chart';

// ──────────────────────────────────────────────────────────────────────────────
// ChartCard (Card wrapper with chart context)
// ──────────────────────────────────────────────────────────────────────────────

interface ChartCardProps extends React.HTMLAttributes<HTMLDivElement> {
  isLoading?: boolean;
  isDisabled?: boolean;
  config?: ChartConfig;
}

const ChartCard = React.forwardRef<HTMLDivElement, ChartCardProps>(
  ({ isLoading = false, isDisabled = false, config = {}, className, children, ...props }, ref) => (
    <ChartContext.Provider value={{ isLoading, isDisabled, config }}>
      <Card
        ref={ref}
        className={cn(isDisabled && 'pointer-events-none opacity-60', className)}
        {...props}
      >
        {children}
      </Card>
    </ChartContext.Provider>
  ),
);
ChartCard.displayName = 'ChartCard';

// ──────────────────────────────────────────────────────────────────────────────
// ChartHeader
// ──────────────────────────────────────────────────────────────────────────────

interface ChartHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  metric?: React.ReactNode;
  action?: React.ReactNode;
}

const ChartHeader = React.forwardRef<HTMLDivElement, ChartHeaderProps>(
  ({ title, metric, action, className, children, ...props }, ref) => (
    <CardHeader
      ref={ref}
      className={cn('flex flex-row items-center justify-between space-y-0 pb-2', className)}
      {...props}
    >
      <div className="flex flex-col gap-0.5">
        {title && <CardTitle className="text-foreground text-sm font-semibold">{title}</CardTitle>}
        {metric && <div className="text-foreground-lighter text-xs">{metric}</div>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </CardHeader>
  ),
);
ChartHeader.displayName = 'ChartHeader';

// ──────────────────────────────────────────────────────────────────────────────
// ChartContent
// ──────────────────────────────────────────────────────────────────────────────

interface ChartContentProps extends React.HTMLAttributes<HTMLDivElement> {
  height?: number;
  emptyMessage?: string;
  isEmpty?: boolean;
}

const ChartContent = React.forwardRef<HTMLDivElement, ChartContentProps>(
  (
    {
      height = 224,
      emptyMessage = 'No data available',
      isEmpty = false,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const { isLoading } = useChart();

    return (
      <CardContent ref={ref} className={cn('px-4 pt-0 pb-4', className)} {...props}>
        {isLoading ? (
          <Skeleton style={{ height }} className="w-full rounded-md" />
        ) : isEmpty ? (
          <div
            style={{ height }}
            className="text-foreground-muted flex items-center justify-center text-sm"
          >
            {emptyMessage}
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </CardContent>
    );
  },
);
ChartContent.displayName = 'ChartContent';

// ──────────────────────────────────────────────────────────────────────────────
// ChartFooter
// ──────────────────────────────────────────────────────────────────────────────

const ChartFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <CardFooter ref={ref} className={cn('text-foreground-lighter text-xs', className)} {...props} />
  ),
);
ChartFooter.displayName = 'ChartFooter';

// ──────────────────────────────────────────────────────────────────────────────
// ChartTooltip — styled recharts tooltip matching dark theme
// ──────────────────────────────────────────────────────────────────────────────

interface ChartTooltipProps {
  labelFormatter?: (label: string) => string;
  valueFormatter?: (value: number, name: string) => string;
  config?: ChartConfig;
}

function ChartTooltip({
  labelFormatter,
  valueFormatter,
  config: tooltipConfig,
}: ChartTooltipProps) {
  const ctx = useChart();
  const cfg = tooltipConfig ?? ctx.config;

  const renderContent = (props: TooltipProps<ValueType, NameType>) => {
    const { active, payload, label } = props;
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-surface-200 border-border rounded-lg border p-2.5 shadow-lg">
        {label !== undefined && label !== '' && (
          <p className="text-foreground-lighter mb-1.5 text-[11px] font-medium">
            {labelFormatter ? labelFormatter(String(label)) : String(label)}
          </p>
        )}
        <div className="flex flex-col gap-1">
          {payload.map((entry) => {
            const key = String(entry.dataKey ?? entry.name ?? '');
            const configEntry = cfg[key];
            const displayLabel = configEntry?.label ?? entry.name ?? key;
            const color = configEntry?.color ?? (entry.color as string) ?? 'var(--brand-default)';
            const rawValue = entry.value as number;
            const displayValue = valueFormatter
              ? valueFormatter(rawValue, key)
              : (rawValue?.toLocaleString() ?? '');

            return (
              <div key={key} className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: color }}
                />
                <span className="text-foreground-lighter">{displayLabel}:</span>
                <span className="text-foreground font-medium">{displayValue}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return <RechartsTooltip content={renderContent} />;
}

export { Chart, ChartCard, ChartHeader, ChartContent, ChartFooter, ChartTooltip };
