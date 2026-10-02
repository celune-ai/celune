'use client';

import * as React from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../utils';
import { Card, CardContent } from './card';
import { Skeleton } from './skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

// ──────────────────────────────────────────────────────────────────────────────
// MetricCard context
// ──────────────────────────────────────────────────────────────────────────────

interface MetricCardContextValue {
  isLoading: boolean;
}

const MetricCardContext = React.createContext<MetricCardContextValue>({ isLoading: false });

function useMetricCard() {
  return React.useContext(MetricCardContext);
}

// ──────────────────────────────────────────────────────────────────────────────
// MetricCard (root)
// ──────────────────────────────────────────────────────────────────────────────

interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  isLoading?: boolean;
}

const MetricCard = React.forwardRef<HTMLDivElement, MetricCardProps>(
  ({ isLoading = false, className, children, ...props }, ref) => (
    <MetricCardContext.Provider value={{ isLoading }}>
      <Card ref={ref} className={cn('flex flex-col gap-0', className)} {...props}>
        {children}
      </Card>
    </MetricCardContext.Provider>
  ),
);
MetricCard.displayName = 'MetricCard';

// ──────────────────────────────────────────────────────────────────────────────
// MetricCardHeader
// ──────────────────────────────────────────────────────────────────────────────

interface MetricCardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  href?: string;
}

const MetricCardHeader = React.forwardRef<HTMLDivElement, MetricCardHeaderProps>(
  ({ href, className, children, ...props }, ref) => {
    const inner = (
      <div
        ref={ref}
        className={cn(
          'flex items-center justify-between px-4 pt-4 pb-1',
          href && 'group',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );

    if (href) {
      return (
        <a href={href} className="block no-underline">
          {inner}
        </a>
      );
    }

    return inner;
  },
);
MetricCardHeader.displayName = 'MetricCardHeader';

// ──────────────────────────────────────────────────────────────────────────────
// MetricCardLabel
// ──────────────────────────────────────────────────────────────────────────────

interface MetricCardLabelProps extends React.HTMLAttributes<HTMLParagraphElement> {
  tooltip?: React.ReactNode;
}

const MetricCardLabel = React.forwardRef<HTMLParagraphElement, MetricCardLabelProps>(
  ({ tooltip, className, children, ...props }, ref) => {
    const label = (
      <p
        ref={ref}
        className={cn('text-foreground-lighter text-xs font-medium', className)}
        {...props}
      >
        {children}
      </p>
    );

    if (tooltip) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-default items-center gap-1 border-b border-dashed border-current/30">
                {label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return label;
  },
);
MetricCardLabel.displayName = 'MetricCardLabel';

// ──────────────────────────────────────────────────────────────────────────────
// MetricCardContent
// ──────────────────────────────────────────────────────────────────────────────

const MetricCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-end gap-2 px-4 pb-1', className)} {...props} />
  ),
);
MetricCardContent.displayName = 'MetricCardContent';

// ──────────────────────────────────────────────────────────────────────────────
// MetricCardValue
// ──────────────────────────────────────────────────────────────────────────────

const MetricCardValue = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  const { isLoading } = useMetricCard();

  if (isLoading) {
    return <Skeleton className="h-8 w-24 rounded" />;
  }

  return (
    <p
      ref={ref}
      className={cn('text-foreground font-mono text-2xl font-bold tabular-nums', className)}
      {...props}
    >
      {children}
    </p>
  );
});
MetricCardValue.displayName = 'MetricCardValue';

// ──────────────────────────────────────────────────────────────────────────────
// MetricCardDifferential
// ──────────────────────────────────────────────────────────────────────────────

interface MetricCardDifferentialProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'positive' | 'negative' | 'default';
}

const MetricCardDifferential = React.forwardRef<HTMLSpanElement, MetricCardDifferentialProps>(
  ({ variant = 'default', className, children, ...props }, ref) => {
    const { isLoading } = useMetricCard();

    if (isLoading) {
      return <Skeleton className="h-4 w-12 rounded" />;
    }

    const Icon =
      variant === 'positive' ? TrendingUp : variant === 'negative' ? TrendingDown : Minus;

    return (
      <span
        ref={ref}
        className={cn(
          'mb-0.5 inline-flex items-center gap-0.5 text-[11px] font-medium',
          variant === 'positive' && 'text-emerald-400',
          variant === 'negative' && 'text-red-400',
          variant === 'default' && 'text-foreground-lighter',
          className,
        )}
        {...props}
      >
        <Icon className="h-3 w-3" strokeWidth={2.5} />
        {children}
      </span>
    );
  },
);
MetricCardDifferential.displayName = 'MetricCardDifferential';

// ──────────────────────────────────────────────────────────────────────────────
// MetricCardSparkline
// ──────────────────────────────────────────────────────────────────────────────

interface SparklineDataPoint {
  [key: string]: number | string;
}

interface MetricCardSparklineProps {
  data: SparklineDataPoint[];
  dataKey: string;
  color?: string;
  height?: number;
  className?: string;
}

function MetricCardSparkline({
  data,
  dataKey,
  color = 'var(--brand-default)',
  height = 40,
  className,
}: MetricCardSparklineProps) {
  const { isLoading } = useMetricCard();
  const gradientId = React.useId();

  if (isLoading) {
    return <Skeleton style={{ height }} className="w-full rounded" />;
  }

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
          <RechartsTooltip content={() => null} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export {
  MetricCard,
  MetricCardHeader,
  MetricCardLabel,
  MetricCardContent,
  MetricCardValue,
  MetricCardDifferential,
  MetricCardSparkline,
};
