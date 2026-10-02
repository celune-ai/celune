'use client';

import { useWorkspace } from '@/providers/workspace-provider';
import { HealthZeroState } from './health-zero-state';
import { KpiStrip } from './kpi-strip';
import { AgentStatusGrid } from './agent-status-grid';
import { VelocityChart } from './velocity-chart';
import { CostTrendChart } from './cost-trend-chart';
import { UtilizationHeatmap } from './utilization-heatmap';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function AgentHealthDashboard() {
  const { activeWorkspace } = useWorkspace();

  // Show zero state for workspaces less than 7 days old
  if (activeWorkspace?.created_at) {
    const age = Date.now() - new Date(activeWorkspace.created_at).getTime();
    if (age < SEVEN_DAYS_MS) {
      return <HealthZeroState />;
    }
  }

  return (
    <div className="space-y-4 pt-2">
      {/* KPI Strip */}
      <KpiStrip />

      {/* Agent Status Grid */}
      <AgentStatusGrid />

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <VelocityChart />
        <CostTrendChart />
      </div>

      {/* Heatmap */}
      <UtilizationHeatmap />
    </div>
  );
}
