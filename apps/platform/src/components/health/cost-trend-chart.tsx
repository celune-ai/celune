'use client';

import { useCallback, useEffect, useState } from 'react';
import { AreaChartCard } from '@/components/charts/area-chart-card';
import { ChartError } from '@/components/charts/chart-error';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { useWorkspaceApiParam } from '@/hooks/use-workspace-api-param';

interface CostTrendData {
  daily: Array<{ date: string; opus: number; sonnet: number; haiku: number }>;
}

const SERIES = [
  { dataKey: 'opus', color: '#34B27B', label: 'Opus' },
  { dataKey: 'sonnet', color: '#3B82F6', label: 'Sonnet' },
  { dataKey: 'haiku', color: '#F59E0B', label: 'Haiku' },
];

export function CostTrendChart() {
  const [data, setData] = useState<CostTrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const wsParam = useWorkspaceApiParam();

  const load = useCallback(() => {
    if (!wsParam) return;
    setLoading(true);
    setError(false);
    fetchJson<CostTrendData>(apiUrl(`/api/analytics/cost/trend?days=30&${wsParam}`))
      .then((d) => {
        if (d && 'daily' in d) setData(d);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [wsParam]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !loading) return <ChartError onRetry={load} />;

  return (
    <AreaChartCard
      title="Cost by Model Per Day"
      data={data?.daily ?? []}
      series={SERIES}
      xKey="date"
      yFormatter={(v) => `$${v.toFixed(2)}`}
      loading={loading}
    />
  );
}
