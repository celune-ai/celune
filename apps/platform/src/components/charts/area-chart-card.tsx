'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';

interface AreaSeries {
  dataKey: string;
  color: string;
  label: string;
}

interface AreaChartCardProps {
  title: string;
  data: Array<Record<string, string | number>>;
  series: AreaSeries[];
  xKey: string;
  yFormatter?: (v: number) => string;
  loading?: boolean;
}

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="bg-surface-300 mb-3 h-4 w-32 rounded" />
      <div className="bg-surface-200 h-48 w-full rounded" />
    </div>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
  yFormatter,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  yFormatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const fmt = yFormatter ?? ((v: number) => String(v));
  return (
    <div className="border-border bg-surface-100 rounded-md border px-3 py-2 text-xs shadow-md">
      <p className="text-foreground-lighter mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-foreground">
            {p.name}: {fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AreaChartCard({
  title,
  data,
  series,
  xKey,
  yFormatter,
  loading,
}: AreaChartCardProps) {
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
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 10, fill: 'var(--color-foreground-lighter)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--color-foreground-lighter)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={yFormatter}
            />
            <Tooltip content={<CustomTooltip yFormatter={yFormatter} />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: 'var(--color-foreground-lighter)' }}
            />
            {series.map((s) => (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.label}
                stroke={s.color}
                strokeWidth={1.5}
                fill={s.color}
                fillOpacity={0.15}
                dot={false}
                stackId="1"
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
