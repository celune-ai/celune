'use client';

import { Area, AreaChart, ResponsiveContainer } from 'recharts';

interface KpiCardProps {
  label: string;
  value: string | number;
  delta?: number | null;
  sparklineData?: number[];
  sparklineColor?: string;
  loading?: boolean;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="bg-surface-300 h-3 w-16 rounded" />
      <div className="bg-surface-300 h-7 w-24 rounded" />
      <div className="bg-surface-300 h-4 w-full rounded" />
    </div>
  );
}

export function KpiCard({
  label,
  value,
  delta,
  sparklineData,
  sparklineColor = 'var(--color-brand)',
  loading,
}: KpiCardProps) {
  if (loading) {
    return (
      <div className="border-border bg-surface-75 rounded-lg border p-4">
        <Skeleton />
      </div>
    );
  }

  const deltaColor =
    delta == null
      ? ''
      : delta > 0
        ? 'text-green-500'
        : delta < 0
          ? 'text-red-400'
          : 'text-foreground-lighter';
  const deltaPrefix = delta != null && delta > 0 ? '+' : '';

  const chartData = (sparklineData ?? []).map((v, i) => ({ i, v }));

  return (
    <div className="border-border bg-surface-75 flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-foreground-lighter text-xs font-medium">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="text-foreground text-2xl font-semibold tabular-nums">{value}</span>
        {delta != null && (
          <span className={`text-xs font-medium ${deltaColor}`}>
            {deltaPrefix}
            {delta}%
          </span>
        )}
      </div>
      {chartData.length > 1 && (
        <div className="mt-1 h-8 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient
                  id={`spark-${label.replace(/\s/g, '')}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={sparklineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={sparklineColor}
                strokeWidth={1.5}
                fill={`url(#spark-${label.replace(/\s/g, '')})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
