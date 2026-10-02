'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { ChartError } from '@/components/charts/chart-error';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { useWorkspaceApiParam } from '@/hooks/use-workspace-api-param';

interface VelocityData {
  weeks: Array<{ week: string; count: number }>;
  thisWeek: number;
  lastWeek: number;
  avgPerWeek: number;
  delta: number;
}

export function VelocityChart() {
  const [data, setData] = useState<VelocityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const wsParam = useWorkspaceApiParam();

  const load = useCallback(() => {
    if (!wsParam) return;
    setLoading(true);
    setError(false);
    fetchJson<VelocityData>(apiUrl(`/api/analytics/velocity?weeks=12&${wsParam}`))
      .then((d) => {
        if (d && 'weeks' in d) setData(d);
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
    <BarChartCard
      title="Task Velocity (weekly)"
      data={data?.weeks ?? []}
      dataKey="count"
      xKey="week"
      color="#34B27B"
      loading={loading}
    />
  );
}
