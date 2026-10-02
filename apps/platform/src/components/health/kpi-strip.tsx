'use client';

import { useCallback, useEffect, useState } from 'react';
import { KpiCard } from '@/components/charts/kpi-card';
import { ChartError } from '@/components/charts/chart-error';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { useWorkspaceApiParam } from '@/hooks/use-workspace-api-param';

interface DashboardData {
  tasksCompleted: number;
  tasksDelta: number | null;
  tasksSparkline: number[];
  avgCompletionHours: number | null;
  activeAgents: number;
  totalAgents: number;
  totalCost: number;
  costDelta: number | null;
  costSparkline: number[];
  errorRate: number;
  errorCount: number;
  totalEvents: number;
}

export function KpiStrip() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const wsParam = useWorkspaceApiParam();

  const load = useCallback(() => {
    if (!wsParam) return;
    setLoading(true);
    setError(false);
    fetchJson<DashboardData>(apiUrl(`/api/analytics/dashboard?${wsParam}`))
      .then((d) => {
        if (d && typeof d === 'object' && !('error' in d)) setData(d);
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
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <KpiCard
        label="Tasks Completed"
        value={data?.tasksCompleted ?? 0}
        delta={data?.tasksDelta}
        sparklineData={data?.tasksSparkline}
        sparklineColor="#34B27B"
        loading={loading}
      />
      <KpiCard
        label="Avg Completion"
        value={data?.avgCompletionHours != null ? `${data.avgCompletionHours}h` : '—'}
        loading={loading}
      />
      <KpiCard
        label="Active Agents"
        value={data != null ? `${data.activeAgents}/${data.totalAgents}` : '—'}
        sparklineColor="#3B82F6"
        loading={loading}
      />
      <KpiCard
        label="Cost (7d)"
        value={data != null ? `$${data.totalCost.toFixed(2)}` : '—'}
        delta={data?.costDelta}
        sparklineData={data?.costSparkline}
        sparklineColor="#F59E0B"
        loading={loading}
      />
      <KpiCard
        label="Error Rate"
        value={data != null ? `${data.errorRate}%` : '—'}
        loading={loading}
      />
      <KpiCard label="Events (7d)" value={data?.totalEvents ?? 0} loading={loading} />
    </div>
  );
}
