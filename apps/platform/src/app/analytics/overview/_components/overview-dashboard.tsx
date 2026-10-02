'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { RefreshCw, TrendingUp, TrendingDown, Minus, Activity, AlertTriangle } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Skeleton } from '@repo/ui/components/skeleton';
import { Badge } from '@repo/ui/components/badge';
import {
  MetricCard,
  MetricCardHeader,
  MetricCardLabel,
  MetricCardContent,
  MetricCardValue,
  MetricCardDifferential,
  MetricCardSparkline,
} from '@repo/ui/components/metric-card';
import { BarChartCard } from '@repo/ui/components/bar-chart';
import { LineChartCard } from '@repo/ui/components/line-chart';
import { LogsBarChart } from '@repo/ui/components/logs-bar-chart';
import { ChartCard, ChartHeader, ChartContent } from '@repo/ui/components/chart';
import type { ChartConfig } from '@repo/ui/components/chart';
import { ErrorState } from '@/components/error-state';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { createClient } from '@repo/db/client';
import { useActionBarContent } from '../../action-bar-context';

// ─── API response types ──────────────────────────────────────────────────────

interface VelocityWeek {
  week: string;
  start: string;
  end: string;
  count: number;
}

interface VelocityData {
  weeks: VelocityWeek[];
  thisWeek: number;
  lastWeek: number;
  avgPerWeek: number;
  delta: number;
}

interface AgentDatum {
  agent: string;
  label: string;
  count: number;
  color: string;
}

interface PriorityDatum {
  name: string;
  value: number;
  color: string;
}

interface CostData {
  totalTokens: number;
  totalCost: number;
  totalTimeMinutes: number;
  handoffCount: number;
  tasksWithCost: number;
}

interface CompletionTimeAgent {
  agent: string;
  label: string;
  avgHours: number;
  count: number;
}

interface CompletionTimeData {
  byAgent: CompletionTimeAgent[];
  staleCount: number;
  staleInProgress: number;
  staleInbox: number;
}

interface OverviewData {
  total: number;
  inProgress: number;
  doneToday: number;
  doneThisWeek: number;
  overdue: number;
  completionRate: number;
}

// ─── Chart configs ───────────────────────────────────────────────────────────

const velocityConfig: ChartConfig = {
  count: { label: 'Tasks Completed', color: 'hsl(var(--brand-default))' },
};

const agentConfig: ChartConfig = {
  count: { label: 'Completed', color: '#666' },
};

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: '#F04438',
  High: '#F59E0B',
  Normal: '#34B27B',
  Low: '#3B82F6',
};

// ─── Main component ──────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [velocity, setVelocity] = useState<VelocityData | null>(null);
  const [agents, setAgents] = useState<AgentDatum[]>([]);
  const [priorities, setPriorities] = useState<PriorityDatum[]>([]);
  const [cost, setCost] = useState<CostData | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [completionTime, setCompletionTime] = useState<CompletionTimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const { setContent } = useActionBarContent();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [v, a, p, c, o, ct] = await Promise.all([
        fetchJson<VelocityData>(apiUrl('/api/analytics/velocity?weeks=12')),
        fetchJson<{ agents: AgentDatum[] }>(apiUrl('/api/analytics/agents')),
        fetchJson<{ priorities: PriorityDatum[] }>(apiUrl('/api/analytics/priorities')),
        fetchJson<CostData>(apiUrl('/api/analytics/cost')),
        fetchJson<OverviewData>(apiUrl('/api/analytics/overview')),
        fetchJson<CompletionTimeData>(apiUrl('/api/analytics/completion-time')),
      ]);
      setVelocity(v);
      setAgents(a.agents);
      setPriorities(p.priorities);
      setCost(c);
      setOverview(o);
      setCompletionTime(ct);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setContent(
      <>
        {realtimeConnected && (
          <Badge
            variant="brand"
            className="gap-1 text-xs"
            style={{ backgroundColor: '#34B27B', borderColor: '#34B27B', color: '#161616' }}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#161616]" />
            Live
          </Badge>
        )}
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
  }, [lastUpdated, loading, realtimeConnected, fetchData, setContent]);

  // Supabase Realtime for live updates — refetch analytics on any task change
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel('analytics-tasks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchData();
      })
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
      setRealtimeConnected(false);
    };
  }, [fetchData]);

  // ── Derived data ──

  // Sparkline data from velocity weeks
  const velocitySparkline = useMemo(
    () => velocity?.weeks.map((w) => ({ week: w.week, count: w.count })) ?? [],
    [velocity],
  );

  // Delta variant for metric card
  const deltaVariant = useMemo(() => {
    if (!velocity) return 'default' as const;
    return velocity.delta > 0
      ? ('positive' as const)
      : velocity.delta < 0
        ? ('negative' as const)
        : ('default' as const);
  }, [velocity]);

  // Activity data for logs bar chart (simulate from velocity weeks)
  const activityData = useMemo(() => {
    if (!velocity) return [];
    return velocity.weeks.map((w) => ({
      timestamp: w.start,
      ok_count: w.count,
      error_count: 0,
      warning_count: 0,
    }));
  }, [velocity]);

  const isInitialLoad = loading && !velocity;

  return (
    <div className="space-y-6 p-6">
      {error && <ErrorState message={error} onRetry={fetchData} />}

      {/* ── Summary Metric Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Tasks completed across all time">
              Total Completed
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>
              {overview?.total != null
                ? `${Math.round((overview.completionRate ?? 0) * 100)}%`
                : '—'}
            </MetricCardValue>
            <MetricCardDifferential variant="default">
              {overview ? `${overview.doneThisWeek} done / ${overview.total} total` : ''}
            </MetricCardDifferential>
          </MetricCardContent>
          <MetricCardSparkline data={velocitySparkline} dataKey="count" />
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Tasks completed this week (Mon–Sun)">
              This Week
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{velocity?.thisWeek ?? '—'}</MetricCardValue>
            <MetricCardDifferential variant={deltaVariant}>
              {velocity ? `${velocity.delta > 0 ? '+' : ''}${velocity.delta}% vs last week` : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Average tasks completed per week over last 12 weeks">
              Avg / Week
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{velocity?.avgPerWeek ?? '—'}</MetricCardValue>
          </MetricCardContent>
          <MetricCardSparkline
            data={velocitySparkline}
            dataKey="count"
            color="hsl(var(--brand-default))"
          />
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Currently in-progress tasks">In Progress</MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{overview?.inProgress ?? '—'}</MetricCardValue>
            {overview && overview.overdue > 0 && (
              <MetricCardDifferential variant="negative">
                {overview.overdue} overdue
              </MetricCardDifferential>
            )}
          </MetricCardContent>
        </MetricCard>
      </div>

      {/* ── Activity bar (logs-style) ── */}
      <div className="border-border bg-surface-100 rounded-lg border p-4">
        <div className="mb-2 flex items-center gap-2">
          <Activity className="text-foreground-lighter h-4 w-4" />
          <span className="text-foreground text-sm font-semibold">Weekly Activity</span>
        </div>
        <LogsBarChart data={activityData} height={64} isLoading={isInitialLoad} />
      </div>

      {/* ── Velocity Chart with benchmark line ── */}
      <ChartCard isLoading={isInitialLoad}>
        <ChartHeader title="Weekly Velocity" metric="Last 12 weeks" />
        <ChartContent
          height={256}
          isEmpty={!isInitialLoad && (velocity?.weeks.length ?? 0) === 0}
          emptyMessage="No completed tasks yet"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={velocity?.weeks ?? []}
              margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-default)"
                vertical={false}
              />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip
                formatter={(value: number) => [value, 'Tasks']}
                contentStyle={{
                  background: 'var(--surface-200)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: 'var(--foreground-default)',
                }}
              />
              <Bar dataKey="count" fill="hsl(var(--brand-default))" radius={[3, 3, 0, 0]} />
              {velocity && velocity.avgPerWeek > 0 && (
                <ReferenceLine
                  y={velocity.avgPerWeek}
                  stroke="#F59E0B"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: `Avg: ${velocity.avgPerWeek}`,
                    position: 'right',
                    fill: '#F59E0B',
                    fontSize: 11,
                  }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </ChartContent>
      </ChartCard>

      {/* ── Agent + Priority row ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Agent completions */}
        <BarChartCard
          data={agents}
          dataKey="count"
          categoryKey="label"
          config={agentConfig}
          layout="vertical"
          colorKey="color"
          title="Completions by Agent"
          height={Math.max(200, agents.length * 36)}
          showYAxis
          isLoading={isInitialLoad}
          isEmpty={!isInitialLoad && agents.length === 0}
          emptyMessage="No agent data yet"
        />

        {/* Priority distribution - Pie/Donut */}
        <ChartCard isLoading={isInitialLoad}>
          <ChartHeader title="Priority Distribution" />
          <ChartContent
            height={280}
            isEmpty={!isInitialLoad && priorities.length === 0}
            emptyMessage="No priority data"
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={priorities}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={3}
                  strokeWidth={0}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {priorities.map((entry) => (
                    <Cell key={entry.name} fill={PRIORITY_COLORS[entry.name] ?? entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0];
                    return (
                      <div className="bg-surface-200 border-border rounded-lg border p-2.5 shadow-lg">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ background: d.payload?.fill as string }}
                          />
                          <span className="text-foreground-lighter">{d.name}:</span>
                          <span className="text-foreground font-medium">{d.value}</span>
                        </div>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartContent>
          {/* Legend */}
          <div className="flex flex-wrap items-center justify-center gap-3 px-4 pb-4">
            {priorities.map((p) => (
              <div key={p.name} className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: PRIORITY_COLORS[p.name] ?? p.color }}
                />
                <span className="text-foreground-lighter">
                  {p.name} ({p.value})
                </span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* ── Stale KPI + Time-to-Completion Chart ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Stale / blocked tasks */}
        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Tasks stuck: in_progress >24h or inbox >3 days">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              Stale Tasks
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{completionTime ? completionTime.staleCount : '—'}</MetricCardValue>
            {completionTime && completionTime.staleCount > 0 && (
              <MetricCardDifferential variant="negative">
                {completionTime.staleInProgress} in-progress, {completionTime.staleInbox} inbox
              </MetricCardDifferential>
            )}
          </MetricCardContent>
        </MetricCard>

        {/* Avg time-to-completion by agent */}
        <ChartCard isLoading={isInitialLoad}>
          <ChartHeader title="Avg Completion Time by Agent" metric="Hours (claimed → done)" />
          <ChartContent
            height={Math.max(160, (completionTime?.byAgent.length ?? 0) * 36 + 40)}
            isEmpty={!isInitialLoad && (completionTime?.byAgent.length ?? 0) === 0}
            emptyMessage="No completion data yet"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={completionTime?.byAgent ?? []}
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
                  width={72}
                />
                <Tooltip
                  formatter={(value: number) => [`${value}h`, 'Avg']}
                  contentStyle={{
                    background: 'var(--surface-200)',
                    border: '1px solid var(--border-default)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: 'var(--foreground-default)',
                  }}
                />
                <Bar dataKey="avgHours" fill="#3B82F6" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContent>
        </ChartCard>
      </div>

      {/* ── Velocity trend line (area chart) ── */}
      <LineChartCard
        data={velocity?.weeks ?? []}
        dataKey="count"
        categoryKey="week"
        config={{ count: { label: 'Completed', color: 'hsl(var(--brand-default))' } }}
        title="Velocity Trend"
        metric="12-week trajectory"
        showArea
        showGrid
        showDots
        height={200}
        isLoading={isInitialLoad}
        isEmpty={!isInitialLoad && (velocity?.weeks.length ?? 0) === 0}
      />

      {/* ── Cost & Resource Tracking ── */}
      {cost && cost.tasksWithCost > 0 && (
        <>
          <h3 className="text-foreground-lighter mt-2 text-xs font-medium tracking-wider uppercase">
            Resource Usage
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard>
              <MetricCardHeader>
                <MetricCardLabel tooltip="Total tokens consumed across all tracked tasks">
                  Total Tokens
                </MetricCardLabel>
              </MetricCardHeader>
              <MetricCardContent>
                <MetricCardValue>{cost.totalTokens.toLocaleString()}</MetricCardValue>
                <MetricCardDifferential variant="default">
                  {cost.tasksWithCost} tasks tracked
                </MetricCardDifferential>
              </MetricCardContent>
            </MetricCard>

            <MetricCard>
              <MetricCardHeader>
                <MetricCardLabel tooltip="Estimated cost based on Anthropic pricing">
                  Total Cost
                </MetricCardLabel>
              </MetricCardHeader>
              <MetricCardContent>
                <MetricCardValue>${(cost.totalCost / 100).toFixed(2)}</MetricCardValue>
              </MetricCardContent>
            </MetricCard>

            <MetricCard>
              <MetricCardHeader>
                <MetricCardLabel tooltip="Total active session time across tasks">
                  Active Time
                </MetricCardLabel>
              </MetricCardHeader>
              <MetricCardContent>
                <MetricCardValue>
                  {Math.round(cost.totalTimeMinutes / 60)}h {cost.totalTimeMinutes % 60}m
                </MetricCardValue>
              </MetricCardContent>
            </MetricCard>

            <MetricCard>
              <MetricCardHeader>
                <MetricCardLabel tooltip="Number of agent-to-agent task handoffs">
                  Agent Handoffs
                </MetricCardLabel>
              </MetricCardHeader>
              <MetricCardContent>
                <MetricCardValue>{cost.handoffCount}</MetricCardValue>
              </MetricCardContent>
            </MetricCard>
          </div>
        </>
      )}
    </div>
  );
}
