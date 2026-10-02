'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import {
  MetricCard,
  MetricCardHeader,
  MetricCardLabel,
  MetricCardContent,
  MetricCardValue,
  MetricCardDifferential,
  MetricCardSparkline,
} from '@repo/ui/components/metric-card';
import { TodayFocus } from '@/components/today-focus';
import { ErrorState } from '@/components/error-state';
import { fetchJson } from '@/lib/fetch-json';
import type { Task } from '@repo/types';
import { apiUrl } from '@repo/db/api';
import { useWorkspaceApiParam } from '@/hooks/use-workspace-api-param';

// ── Types ────────────────────────────────────────────────────────────────────

interface TaskStats {
  total: number;
  inProgress: number;
  doneToday: number;
  overdue: number;
}

interface DashboardKPIs {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeStats(tasks: Task[]): TaskStats {
  const today = new Date().toISOString().slice(0, 10);

  return {
    total: tasks.length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    doneToday: tasks.filter((t) => t.completed_at && t.completed_at.slice(0, 10) === today).length,
    overdue: tasks.filter((t) => t.due_date && t.due_date < today && t.status !== 'done').length,
  };
}

function deltaVariant(delta: number | null): 'positive' | 'negative' | 'default' {
  if (delta === null) return 'default';
  return delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'default';
}

function formatDelta(delta: number | null): string {
  if (delta === null) return '';
  return `${delta > 0 ? '+' : ''}${delta}% vs last week`;
}

// ── Component ────────────────────────────────────────────────────────────────

export const OverviewWidgets = memo(function OverviewWidgets() {
  const [stats, setStats] = useState<TaskStats>({
    total: 0,
    inProgress: 0,
    doneToday: 0,
    overdue: 0,
  });
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsParam = useWorkspaceApiParam();

  const load = useCallback(() => {
    if (!wsParam) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const qs = `?${wsParam}`;

    async function fetchData() {
      try {
        const [tasksRes, dashboardData] = await Promise.all([
          fetch(apiUrl(`/api/tasks${qs}`)),
          fetchJson<DashboardKPIs>(apiUrl(`/api/analytics/dashboard${qs}`)).catch(() => null),
        ]);

        if (cancelled) return;

        if (!tasksRes.ok) throw new Error(`HTTP ${tasksRes.status}`);

        const tasks: Task[] = await tasksRes.json();
        setStats(computeStats(tasks));

        if (dashboardData) {
          setKpis(dashboardData);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load overview data';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [wsParam]);

  useEffect(() => {
    const cleanup = load();
    const interval = setInterval(load, 30_000);
    return () => {
      cleanup?.();
      clearInterval(interval);
    };
  }, [load]);

  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  const isInitialLoad = loading && !kpis;

  // Build sparkline data arrays for MetricCardSparkline
  const tasksSparkData = (kpis?.tasksSparkline ?? []).map((v, i) => ({ day: i, count: v }));
  const costSparkData = (kpis?.costSparkline ?? []).map((v, i) => ({ day: i, cost: v }));

  return (
    <div className="space-y-4">
      {/* ── KPI Metric Cards (from /api/analytics/dashboard) ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Tasks completed in the last 7 days">
              Done This Week
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{kpis?.tasksCompleted ?? stats.doneToday}</MetricCardValue>
            <MetricCardDifferential variant={deltaVariant(kpis?.tasksDelta ?? null)}>
              {formatDelta(kpis?.tasksDelta ?? null)}
            </MetricCardDifferential>
          </MetricCardContent>
          {tasksSparkData.length > 0 && (
            <MetricCardSparkline data={tasksSparkData} dataKey="count" />
          )}
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Currently in-progress tasks">In Progress</MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{stats.inProgress}</MetricCardValue>
            {stats.overdue > 0 && (
              <MetricCardDifferential variant="negative">
                {stats.overdue} overdue
              </MetricCardDifferential>
            )}
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Active agents / total agents">Active Agents</MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>
              {kpis ? `${kpis.activeAgents}/${kpis.totalAgents}` : '\u2014'}
            </MetricCardValue>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="API cost in the last 7 days">Weekly Cost</MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{kpis ? `$${kpis.totalCost.toFixed(2)}` : '\u2014'}</MetricCardValue>
            <MetricCardDifferential variant={deltaVariant(kpis?.costDelta ?? null)}>
              {formatDelta(kpis?.costDelta ?? null)}
            </MetricCardDifferential>
          </MetricCardContent>
          {costSparkData.length > 0 && (
            <MetricCardSparkline data={costSparkData} dataKey="cost" color="#F59E0B" />
          )}
        </MetricCard>
      </div>

      {/* ── Secondary Stats Row + Today's Focus ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel>Total Tasks</MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{stats.total}</MetricCardValue>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Average hours from claim to completion (last 30 days)">
              Avg Completion
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>
              {kpis?.avgCompletionHours != null ? `${kpis.avgCompletionHours}h` : '\u2014'}
            </MetricCardValue>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Error rate from activity log (last 7 days)">
              Error Rate
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{kpis ? `${kpis.errorRate}%` : '\u2014'}</MetricCardValue>
            {kpis && kpis.errorCount > 0 && (
              <MetricCardDifferential variant="negative">
                {kpis.errorCount} errors / {kpis.totalEvents} events
              </MetricCardDifferential>
            )}
          </MetricCardContent>
        </MetricCard>

        <TodayFocus />
      </div>
    </div>
  );
});
