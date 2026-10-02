'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface BarChartCardProps {
  title: string;
  data: Array<Record<string, string | number>>;
  dataKey: string;
  xKey: string;
  color?: string;
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
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border bg-surface-100 rounded-md border px-3 py-2 text-xs shadow-md">
      <p className="text-foreground-lighter">{label}</p>
      <p className="text-foreground font-medium">{payload[0].value}</p>
    </div>
  );
}

export function BarChartCard({
  title,
  data,
  dataKey,
  xKey,
  color = 'var(--color-brand)',
  loading,
}: BarChartCardProps) {
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
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
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
              allowDecimals={false}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: 'var(--color-surface-200)', opacity: 0.5 }}
            />
            <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
