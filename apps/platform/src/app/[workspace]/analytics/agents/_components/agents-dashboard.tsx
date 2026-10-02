'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { RefreshCw, Users, Clock, DollarSign, Zap, Database, PiggyBank } from 'lucide-react';
import { useActionBarContent } from '../../action-bar-context';
import { Button } from '@repo/ui/components/button';
import {
  MetricCard,
  MetricCardHeader,
  MetricCardLabel,
  MetricCardContent,
  MetricCardValue,
  MetricCardDifferential,
} from '@repo/ui/components/metric-card';
import { ChartCard, ChartHeader, ChartContent } from '@repo/ui/components/chart';
import { ErrorState } from '@/components/error-state';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { TOOLTIP_STYLE, fmtCost } from '@/lib/chart-utils';
import { useWorkspaceApiParam } from '@/hooks/use-workspace-api-param';

// ─── Health types ─────────────────────────────────────────────────────────────

interface AgentHealth {
  agent: string;
  label: string;
  color: string;
  completed: number;
  avgHours: number | null;
  totalCost: number;
  costPerTask: number;
  efficiency: number;
}

interface AgentHealthData {
  agents: AgentHealth[];
}

// ─── Cache types ──────────────────────────────────────────────────────────────

interface AgentCacheRow {
  agent: string;
  label: string;
  color: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  hitRate: number;
  creationRate: number;
  estimatedSavings: number;
}

interface AgentCacheData {
  systemHitRate: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalInputTokens: number;
  totalEstimatedSavings: number;
  agents: AgentCacheRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentsDashboard() {
  const [data, setData] = useState<AgentHealthData | null>(null);
  const [cacheData, setCacheData] = useState<AgentCacheData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { setContent } = useActionBarContent();
  const wsParam = useWorkspaceApiParam();

  const fetchData = useCallback(async () => {
    if (!wsParam) return;
    setLoading(true);
    setError(null);
    const qs = `?${wsParam}`;
    try {
      const [health, cache] = await Promise.all([
        fetchJson<AgentHealthData>(apiUrl(`/api/analytics/agents/health${qs}`)),
        fetchJson<AgentCacheData>(apiUrl(`/api/analytics/agents/cache${qs}`)),
      ]);
      setData(health);
      setCacheData(cache);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent data');
    } finally {
      setLoading(false);
    }
  }, [wsParam]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setContent(
      <>
        {lastUpdated && (
          <span className="text-foreground-lighter text-[11px]">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        <Button variant="outline" size="md" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </>,
    );
    return () => setContent(null);
  }, [lastUpdated, loading, fetchData, setContent]);

  const agents = data?.agents ?? [];
  const isInitialLoad = loading && !data;

  // Summary metrics
  const totalCompleted = useMemo(() => agents.reduce((s, a) => s + a.completed, 0), [agents]);
  const totalCost = useMemo(() => agents.reduce((s, a) => s + a.totalCost, 0), [agents]);
  const avgCostPerTask = useMemo(
    () => (totalCompleted > 0 ? totalCost / totalCompleted : 0),
    [totalCompleted, totalCost],
  );
  const mostEfficient = useMemo(() => {
    const withTasks = agents.filter((a) => a.completed >= 3);
    if (withTasks.length === 0) return null;
    return withTasks.reduce((best, a) => (a.efficiency > best.efficiency ? a : best));
  }, [agents]);

  // Data for charts
  const completionData = useMemo(
    () => agents.map((a) => ({ label: a.label, completed: a.completed, color: a.color })),
    [agents],
  );

  const costPerTaskData = useMemo(
    () =>
      agents
        .filter((a) => a.costPerTask > 0)
        .map((a) => ({ label: a.label, costPerTask: a.costPerTask, color: a.color }))
        .sort((a, b) => b.costPerTask - a.costPerTask),
    [agents],
  );

  const completionTimeData = useMemo(
    () =>
      agents
        .filter((a) => a.avgHours !== null)
        .map((a) => ({ label: a.label, avgHours: a.avgHours!, color: a.color }))
        .sort((a, b) => b.avgHours - a.avgHours),
    [agents],
  );

  // Cache chart data: sorted by hit rate descending
  const cacheHitChartData = useMemo(
    () =>
      (cacheData?.agents ?? [])
        .filter((a) => a.requests > 0)
        .map((a) => ({ label: a.label, hitRate: a.hitRate, color: a.color }))
        .sort((a, b) => b.hitRate - a.hitRate),
    [cacheData],
  );

  const isCacheInitialLoad = loading && !cacheData;

  return (
    <div className="space-y-6 p-6">
      {error && <ErrorState message={error} onRetry={fetchData} />}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Total tasks completed by all agents">
              <Users className="mr-1 inline h-3.5 w-3.5" />
              Total Completed
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{data ? totalCompleted : '—'}</MetricCardValue>
            <MetricCardDifferential variant="default">
              {data ? `${agents.length} agents` : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Total Claude API cost across all agents">
              <DollarSign className="mr-1 inline h-3.5 w-3.5" />
              Total Agent Cost
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{data ? fmtCost(totalCost) : '—'}</MetricCardValue>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Average cost per completed task across all agents">
              <Clock className="mr-1 inline h-3.5 w-3.5" />
              Avg Cost/Task
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{data ? fmtCost(avgCostPerTask) : '—'}</MetricCardValue>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Agent with highest tasks-per-dollar ratio (min 3 tasks)">
              <Zap className="mr-1 inline h-3.5 w-3.5" />
              Most Efficient
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{mostEfficient?.label ?? '—'}</MetricCardValue>
            {mostEfficient && (
              <MetricCardDifferential variant="positive">
                {mostEfficient.efficiency} tasks/$
              </MetricCardDifferential>
            )}
          </MetricCardContent>
        </MetricCard>
      </div>

      {/* Cache Performance KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard isLoading={isCacheInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="System-wide cache hit rate: cache reads as % of total input budget">
              <Database className="mr-1 inline h-3.5 w-3.5" />
              System Cache Hit Rate
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{cacheData ? `${cacheData.systemHitRate}%` : '—'}</MetricCardValue>
            <MetricCardDifferential
              variant={cacheData && cacheData.systemHitRate >= 30 ? 'positive' : 'default'}
            >
              {cacheData && cacheData.systemHitRate >= 30
                ? 'Good prompt caching'
                : cacheData
                  ? 'Low cache utilization'
                  : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isCacheInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Total tokens served from prompt cache (not re-sent as input)">
              <Database className="mr-1 inline h-3.5 w-3.5" />
              Cache Reads
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>
              {cacheData ? fmtTokens(cacheData.totalCacheReadTokens) : '—'}
            </MetricCardValue>
            <MetricCardDifferential variant="default">
              {cacheData ? `${fmtTokens(cacheData.totalCacheCreationTokens)} cached` : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isCacheInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Estimated cost savings from prompt caching vs sending all tokens as fresh input ($3/M input vs $0.30/M cache read)">
              <PiggyBank className="mr-1 inline h-3.5 w-3.5" />
              Cache Savings
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>
              {cacheData ? fmtCost(cacheData.totalEstimatedSavings) : '—'}
            </MetricCardValue>
            <MetricCardDifferential
              variant={cacheData && cacheData.totalEstimatedSavings > 0 ? 'positive' : 'default'}
            >
              {cacheData && cacheData.totalEstimatedSavings > 0 ? 'vs fresh input pricing' : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>
      </div>

      {/* Tasks completed by agent */}
      <ChartCard isLoading={isInitialLoad}>
        <ChartHeader title="Tasks Completed by Agent" />
        <ChartContent
          height={Math.max(200, completionData.length * 40 + 40)}
          isEmpty={!isInitialLoad && completionData.length === 0}
          emptyMessage="No completed tasks yet"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={completionData}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-default)"
                horizontal={false}
              />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                formatter={(value: number) => [value, 'Completed']}
                contentStyle={TOOLTIP_STYLE}
              />
              <Bar dataKey="completed" radius={[0, 3, 3, 0]}>
                {completionData.map((entry) => (
                  <Cell key={entry.label} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContent>
      </ChartCard>

      {/* Cache hit rate by agent */}
      <ChartCard isLoading={isCacheInitialLoad}>
        <ChartHeader title="Cache Hit Rate by Agent" metric="% of input budget served from cache" />
        <ChartContent
          height={Math.max(200, cacheHitChartData.length * 40 + 40)}
          isEmpty={!isCacheInitialLoad && cacheHitChartData.length === 0}
          emptyMessage="No cache data yet — usage is logged via the cost ingest endpoint"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={cacheHitChartData}
              layout="vertical"
              margin={{ top: 4, right: 48, left: 8, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-default)"
                horizontal={false}
              />
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                formatter={(value: number) => [`${value}%`, 'Cache Hit Rate']}
                contentStyle={TOOLTIP_STYLE}
              />
              <Bar dataKey="hitRate" radius={[0, 3, 3, 0]}>
                {cacheHitChartData.map((entry) => (
                  <Cell key={entry.label} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContent>
      </ChartCard>

      {/* Cost per task + Avg completion time */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard isLoading={isInitialLoad}>
          <ChartHeader title="Cost per Task by Agent" metric="USD" />
          <ChartContent
            height={Math.max(160, costPerTaskData.length * 36 + 40)}
            isEmpty={!isInitialLoad && costPerTaskData.length === 0}
            emptyMessage="No cost data yet"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={costPerTaskData}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border-default)"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tickFormatter={(v: number) => fmtCost(v)}
                  tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  formatter={(value: number) => [fmtCost(value), 'Cost/Task']}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="costPerTask" radius={[0, 3, 3, 0]}>
                  {costPerTaskData.map((entry) => (
                    <Cell key={entry.label} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContent>
        </ChartCard>

        <ChartCard isLoading={isInitialLoad}>
          <ChartHeader title="Avg Completion Time" metric="Hours (claimed → done)" />
          <ChartContent
            height={Math.max(160, completionTimeData.length * 36 + 40)}
            isEmpty={!isInitialLoad && completionTimeData.length === 0}
            emptyMessage="No timing data yet"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={completionTimeData}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border-default)"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tickFormatter={(v: number) => `${v}h`}
                  tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  formatter={(value: number) => [`${value}h`, 'Avg Time']}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="avgHours" fill="#3B82F6" radius={[0, 3, 3, 0]}>
                  {completionTimeData.map((entry) => (
                    <Cell key={entry.label} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContent>
        </ChartCard>
      </div>

      {/* Cache performance detail table */}
      {(cacheData?.agents.length ?? 0) > 0 && (
        <div className="border-border bg-surface-75 overflow-hidden rounded-lg border">
          <div className="px-4 py-3">
            <h3 className="text-foreground text-sm font-medium">Cache Performance by Agent</h3>
            <p className="text-foreground-lighter mt-0.5 text-xs">
              Validates the stable-prefix prompt strategy (Identity → Rules → Process → Task)
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border border-t text-left">
                  <th className="text-foreground-lighter px-4 py-2.5 text-xs font-medium">Agent</th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Requests
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Hit Rate
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Cache Reads
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Cache Created
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Savings
                  </th>
                </tr>
              </thead>
              <tbody>
                {(cacheData?.agents ?? []).map((a) => (
                  <tr key={a.agent} className="border-border border-t">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: a.color }}
                        />
                        <span className="text-foreground text-xs font-medium">{a.label}</span>
                      </div>
                    </td>
                    <td className="text-foreground px-4 py-2.5 text-right text-xs tabular-nums">
                      {a.requests}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                      <span
                        className={
                          a.hitRate >= 30 ? 'text-brand font-medium' : 'text-foreground-lighter'
                        }
                      >
                        {a.hitRate}%
                      </span>
                    </td>
                    <td className="text-foreground-lighter px-4 py-2.5 text-right text-xs tabular-nums">
                      {fmtTokens(a.cacheReadTokens)}
                    </td>
                    <td className="text-foreground-lighter px-4 py-2.5 text-right text-xs tabular-nums">
                      {fmtTokens(a.cacheCreationTokens)}
                    </td>
                    <td className="text-foreground px-4 py-2.5 text-right text-xs tabular-nums">
                      {a.estimatedSavings > 0 ? fmtCost(a.estimatedSavings) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Efficiency table */}
      {agents.length > 0 && (
        <div className="border-border bg-surface-75 overflow-hidden rounded-lg border">
          <div className="px-4 py-3">
            <h3 className="text-foreground text-sm font-medium">Agent Efficiency Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border border-t text-left">
                  <th className="text-foreground-lighter px-4 py-2.5 text-xs font-medium">Agent</th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Tasks
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Avg Time
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Total Cost
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Cost/Task
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Tasks/$
                  </th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agent} className="border-border border-t">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: a.color }}
                        />
                        <span className="text-foreground text-xs font-medium">{a.label}</span>
                      </div>
                    </td>
                    <td className="text-foreground px-4 py-2.5 text-right text-xs tabular-nums">
                      {a.completed}
                    </td>
                    <td className="text-foreground-lighter px-4 py-2.5 text-right text-xs tabular-nums">
                      {a.avgHours != null ? `${a.avgHours}h` : '—'}
                    </td>
                    <td className="text-foreground px-4 py-2.5 text-right text-xs tabular-nums">
                      {fmtCost(a.totalCost)}
                    </td>
                    <td className="text-foreground-lighter px-4 py-2.5 text-right text-xs tabular-nums">
                      {a.costPerTask > 0 ? fmtCost(a.costPerTask) : '—'}
                    </td>
                    <td className="text-foreground px-4 py-2.5 text-right text-xs tabular-nums">
                      {a.efficiency > 0 ? a.efficiency.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
