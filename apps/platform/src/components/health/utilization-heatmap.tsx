'use client';

import { useCallback, useEffect, useState } from 'react';
import { HeatmapCard } from '@/components/charts/heatmap-card';
import { ChartError } from '@/components/charts/chart-error';
import { AGENT_COLORS } from '@/lib/agents-data';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { useWorkspaceApiParam } from '@/hooks/use-workspace-api-param';

interface UtilizationData {
  agents: Array<{ agent_id: string; values: number[] }>;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** All agent IDs to show in the heatmap, including the owner */
const ALL_AGENT_IDS = [
  'eric',
  'rick',
  'sage',
  'noir',
  'scan',
  'delv',
  'trek',
  'echo',
  'bond',
  'vita',
];

export function UtilizationHeatmap() {
  const [data, setData] = useState<UtilizationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const wsParam = useWorkspaceApiParam();

  const load = useCallback(() => {
    if (!wsParam) return;
    setLoading(true);
    setError(false);
    fetchJson<UtilizationData>(apiUrl(`/api/analytics/utilization?days=30&${wsParam}`))
      .then((d) => {
        if (d && 'agents' in d) setData(d);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [wsParam]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !loading) return <ChartError onRetry={load} />;

  const labels = TASK_ASSIGNEE_LABELS as Record<string, string>;
  const dataMap = new Map((data?.agents ?? []).map((a) => [a.agent_id, a.values]));

  // Include all agents, even those with no activity (zero-filled)
  const rows = ALL_AGENT_IDS.map((id) => ({
    label: labels[id] ?? id,
    color: AGENT_COLORS[id]?.hex ?? '#666',
    values: dataMap.get(id) ?? [0, 0, 0, 0, 0, 0, 0],
  }));

  return (
    <HeatmapCard
      title="Agent Utilization (30d)"
      rows={rows}
      columnLabels={DAY_LABELS}
      loading={loading}
      cellSize="xl"
    />
  );
}
