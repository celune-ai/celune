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
import {
  RefreshCw,
  DollarSign,
  Zap,
  TrendingUp,
  Database,
  Flame,
  PiggyBank,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Gauge,
  Mic,
  Volume2,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import {
  MetricCard,
  MetricCardHeader,
  MetricCardLabel,
  MetricCardContent,
  MetricCardValue,
  MetricCardDifferential,
} from '@repo/ui/components/metric-card';
import { LineChartCard } from '@repo/ui/components/line-chart';
import { ChartCard, ChartHeader, ChartContent } from '@repo/ui/components/chart';
import { ErrorState } from '@/components/error-state';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { TOOLTIP_STYLE, fmtCost } from '@/lib/chart-utils';
import { useActionBarContent } from '../../action-bar-context';
import { useWorkspaceApiParam } from '@/hooks/use-workspace-api-param';
import type { Subscription } from '@/app/api/analytics/cost/subscriptions/route';
import type { LimitResult } from '@/app/api/analytics/cost/limits/route';
import type { CreditsData } from '@/app/api/analytics/cost/credits/route';
import type { ElevenLabsAnalyticsData } from '@/app/api/analytics/cost/elevenlabs/route';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DailyRow {
  day: string;
  model: string;
  agent_name: string | null;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_cost_usd: number;
}

interface AgentRow {
  agent_name: string;
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
}

interface ModelRow {
  model: string;
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
}

interface SummaryTotals {
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
}

interface SummaryData {
  totals: SummaryTotals;
  daily: DailyRow[];
  by_agent: AgentRow[];
  by_model: ModelRow[];
}

interface SubscriptionsData {
  subscriptions: Subscription[];
  totalMonthlyUsd: number;
  byCategory: Record<string, number>;
}

interface LimitsData {
  limits: LimitResult[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL_COLOR_MAP: Record<string, string> = {
  'claude-opus-4-6': '#a78bfa',
  'claude-sonnet-4-6': '#34B27B',
  'claude-haiku-4-5-20251001': '#3B82F6',
  'claude-opus-4-5': '#c084fc',
  'claude-sonnet-4-5': '#6ee7b7',
  'claude-haiku-4-5': '#93c5fd',
};

const CATEGORY_LABELS: Record<string, string> = {
  infra: 'Infrastructure',
  ai: 'AI & Models',
  tools: 'Tools',
  domains: 'Domains',
};

const CATEGORY_COLORS: Record<string, string> = {
  infra: '#3B82F6',
  ai: '#a78bfa',
  tools: '#F59E0B',
  domains: '#34B27B',
};

function modelColor(model: string): string {
  return MODEL_COLOR_MAP[model] ?? '#6B7280';
}

function modelShortName(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return model;
}

// ─── Main page ───────────────────────────────────────────────────────────────

const TIME_WINDOWS = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
] as const;

// Approximate Anthropic pricing per 1M tokens (USD) — used for cache savings estimate
const INPUT_PRICE_PER_M = 3.0; // ~$3/M input tokens (blended across models)
const CACHE_READ_PRICE_PER_M = 0.3; // ~$0.30/M cache read tokens

// ─── Limit status helpers ─────────────────────────────────────────────────────

function LimitStatusIcon({ status }: { status: LimitResult['status'] }) {
  if (status === 'over') return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === 'warn') return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  return <Gauge className="text-foreground-lighter h-4 w-4" />;
}

function LimitBar({ pct, status }: { pct: number | null; status: LimitResult['status'] }) {
  const fill = status === 'over' ? 'bg-red-500' : status === 'warn' ? 'bg-amber-500' : 'bg-brand';

  if (pct === null) {
    return (
      <div className="bg-surface-300 h-1.5 w-full rounded-full">
        <div className="bg-surface-400 h-full w-[30%] animate-pulse rounded-full" />
      </div>
    );
  }

  return (
    <div
      className="bg-surface-300 h-1.5 w-full rounded-full"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all ${fill}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

export default function CostDashboard() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [subData, setSubData] = useState<SubscriptionsData | null>(null);
  const [limitsData, setLimitsData] = useState<LimitsData | null>(null);
  const [creditsData, setCreditsData] = useState<CreditsData | null>(null);
  const [elData, setElData] = useState<ElevenLabsAnalyticsData | null>(null);
  const [creditsView, setCreditsView] = useState<'current' | 'historical'>('current');
  const [chartRange, setChartRange] = useState<'weekly' | 'monthly'>('monthly');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [days, setDays] = useState(30);
  const { setContent } = useActionBarContent();
  const wsParam = useWorkspaceApiParam();

  const fetchData = useCallback(async () => {
    if (!wsParam) return;
    setLoading(true);
    setError(null);
    const sep = `&${wsParam}`;
    try {
      const [summary, subs, limits, credits, elevenlabs] = await Promise.all([
        fetchJson<SummaryData>(apiUrl(`/api/analytics/cost/summary?days=${days}${sep}`)),
        fetchJson<SubscriptionsData>(apiUrl('/api/analytics/cost/subscriptions')),
        fetchJson<LimitsData>(apiUrl(`/api/analytics/cost/limits?${wsParam}`)),
        fetchJson<CreditsData>(apiUrl('/api/analytics/cost/credits')).catch(() => null),
        fetchJson<ElevenLabsAnalyticsData>(
          apiUrl(`/api/analytics/cost/elevenlabs?days=${days}`),
        ).catch(() => null),
      ]);
      setData(summary);
      setSubData(subs);
      setLimitsData(limits);
      setCreditsData(credits);
      setElData(elevenlabs);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cost data');
    } finally {
      setLoading(false);
    }
  }, [days, wsParam]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setContent(
      <>
        <div className="border-border flex items-center rounded-md border">
          {TIME_WINDOWS.map((w) => (
            <button
              key={w.value}
              type="button"
              onClick={() => setDays(w.value)}
              className={`cursor-pointer px-3 py-1.5 text-xs font-semibold transition-colors first:rounded-l-[5px] last:rounded-r-[5px] ${
                days === w.value
                  ? 'bg-surface-200 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
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
  }, [lastUpdated, loading, days, fetchData, setContent]);

  // ── Derived data ──

  // Monthly spend: sum daily rows from current calendar month
  const monthlySpend = useMemo(() => {
    if (!data) return 0;
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return data.daily
      .filter((r) => r.day.startsWith(monthPrefix))
      .reduce((s, r) => s + Number(r.total_cost_usd), 0);
  }, [data]);

  // Cache hit rate: cache_read / (input + cache_read)
  const cacheHitRate = useMemo(() => {
    if (!data) return 0;
    const totalCacheRead = data.daily.reduce(
      (s, r) => s + Number(r.total_cache_read_tokens ?? 0),
      0,
    );
    const totalInput = data.daily.reduce((s, r) => s + Number(r.total_input_tokens), 0);
    if (totalInput + totalCacheRead === 0) return 0;
    return Math.round((totalCacheRead / (totalInput + totalCacheRead)) * 100);
  }, [data]);

  // Model distribution %
  const modelDistribution = useMemo(() => {
    if (!data?.by_model.length) return [];
    const total = data.by_model.reduce((s, m) => s + Number(m.total_cost_usd), 0);
    return data.by_model.map((m) => ({
      model: m.model,
      short: modelShortName(m.model),
      pct: total > 0 ? Math.round((Number(m.total_cost_usd) / total) * 100) : 0,
      color: modelColor(m.model),
    }));
  }, [data]);

  // Cache savings
  const cacheSavings = useMemo(() => {
    if (!data) return 0;
    const totalCacheRead = data.daily.reduce(
      (s, r) => s + Number(r.total_cache_read_tokens ?? 0),
      0,
    );
    return (totalCacheRead * (INPUT_PRICE_PER_M - CACHE_READ_PRICE_PER_M)) / 1_000_000;
  }, [data]);

  // Cost per request
  const costPerTask = useMemo(() => {
    if (!data) return 0;
    const totalCost = data.daily.reduce((s, r) => s + Number(r.total_cost_usd), 0);
    const totalRequests = data.daily.reduce((s, r) => s + Number(r.request_count), 0);
    if (totalRequests === 0) return 0;
    return totalCost / totalRequests;
  }, [data]);

  // Daily rows by model, grouped (not stacked) — respects weekly/monthly toggle
  const dailyStacked = useMemo(() => {
    if (!data) return [];
    const sliceCount = chartRange === 'weekly' ? 7 : 30;
    const uniqueDaysSorted = [...new Set(data.daily.map((r) => r.day))].sort().slice(-sliceCount);
    return uniqueDaysSorted.map((day) => {
      const dayRows = data.daily.filter((r) => r.day === day);
      const entry: Record<string, number | string> = { day: day.slice(5) }; // MM-DD
      for (const row of dayRows) {
        const key = modelShortName(row.model);
        entry[key] = Number(entry[key] ?? 0) + Number(row.total_cost_usd);
      }
      return entry;
    });
  }, [data, chartRange]);

  const uniqueModels = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.daily.map((r) => modelShortName(r.model)))];
  }, [data]);

  // Daily total for trend line (ascending)
  const trendData = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, number>();
    for (const row of data.daily) {
      map.set(row.day, (map.get(row.day) ?? 0) + Number(row.total_cost_usd));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, cost]) => ({ day: day.slice(5), cost: Number(cost.toFixed(6)) }));
  }, [data]);

  // Subscription category breakdown for chart
  const subCategoryData = useMemo(() => {
    if (!subData) return [];
    return Object.entries(subData.byCategory)
      .filter(([, v]) => v > 0)
      .map(([cat, amount]) => ({
        category: CATEGORY_LABELS[cat] ?? cat,
        amount,
        color: CATEGORY_COLORS[cat] ?? '#6B7280',
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [subData]);

  const isInitialLoad = loading && !data;
  const isSubInitialLoad = loading && !subData;
  const isLimitsInitialLoad = loading && !limitsData;
  const isCreditsInitialLoad = loading && !creditsData;
  const isElInitialLoad = loading && !elData;

  // ── ElevenLabs derived data ──
  const elSub = elData?.subscription;
  const elQuotaPct = elSub
    ? Math.round((elSub.character_count / Math.max(elSub.character_limit, 1)) * 100)
    : 0;
  const elQuotaStatus: 'ok' | 'warn' | 'over' =
    elQuotaPct >= 95 ? 'over' : elQuotaPct >= 80 ? 'warn' : 'ok';
  const elResetDays = elSub
    ? Math.max(
        0,
        Math.ceil(
          (elSub.next_character_count_reset_unix * 1000 - Date.now()) / (1000 * 60 * 60 * 24),
        ),
      )
    : 0;
  const elRemaining = elSub ? elSub.character_limit - elSub.character_count : 0;

  // Chart data — slice daily to match chartRange
  const elDailyChart = useMemo(() => {
    if (!elData?.daily.length) return [];
    const sliceCount = chartRange === 'weekly' ? 7 : 30;
    return elData.daily.slice(-sliceCount).map((d) => ({
      day: d.day.slice(5), // MM-DD
      characters: d.characters,
    }));
  }, [elData, chartRange]);

  return (
    <div className="space-y-6 p-6">
      {error && <ErrorState message={error} onRetry={fetchData} />}

      {/* ── Credits & Plans ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard isLoading={isCreditsInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Claude Max 20x subscription — includes Claude Code usage">
              <CreditCard className="mr-1 inline h-3.5 w-3.5" />
              Claude Max 20x
            </MetricCardLabel>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Active
            </span>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>
              {creditsData ? `$${creditsData.max.monthlyUsd}` : '—'}
            </MetricCardValue>
            <MetricCardDifferential variant="default">
              {creditsData ? creditsData.max.note : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isCreditsInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Anthropic API prepaid credit balance — separate from Max subscription, reloaded manually">
              <DollarSign className="mr-1 inline h-3.5 w-3.5" />
              API Credits{creditsData?.org.name ? ` · ${creditsData.org.name}` : ''}
            </MetricCardLabel>
            <div className="flex items-center gap-2">
              <div className="border-border flex items-center rounded-md border">
                {(['current', 'historical'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setCreditsView(v)}
                    className={`cursor-pointer px-2 py-1 text-[10px] font-semibold transition-colors first:rounded-l-[5px] last:rounded-r-[5px] ${
                      creditsView === v
                        ? 'bg-surface-200 text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
                    }`}
                  >
                    {v === 'current' ? 'Current' : 'Historical'}
                  </button>
                ))}
              </div>
              {creditsData && creditsView === 'current' && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    creditsData.api.status === 'exhausted'
                      ? 'border-red-500/20 bg-red-500/15 text-red-400'
                      : creditsData.api.status === 'ok'
                        ? 'border-emerald-500/20 bg-emerald-500/15 text-emerald-400'
                        : 'border-yellow-500/20 bg-yellow-500/15 text-yellow-400'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      creditsData.api.status === 'exhausted'
                        ? 'bg-red-400'
                        : creditsData.api.status === 'ok'
                          ? 'bg-emerald-400'
                          : 'bg-yellow-400'
                    }`}
                  />
                  {creditsData.api.status === 'exhausted'
                    ? 'Exhausted'
                    : creditsData.api.status === 'ok'
                      ? 'OK'
                      : 'Unknown'}
                </span>
              )}
            </div>
          </MetricCardHeader>
          {creditsView === 'current' ? (
            <MetricCardContent>
              <MetricCardValue>
                {creditsData ? fmtCost(creditsData.api.monthlySpend) : '—'}
              </MetricCardValue>
              <MetricCardDifferential
                variant={creditsData?.api.status === 'exhausted' ? 'negative' : 'default'}
              >
                {creditsData
                  ? `/ ${fmtCost(creditsData.api.monthlyBudget)} budget${creditsData.api.pctUsed != null ? ` · ${creditsData.api.pctUsed}%` : ''}`
                  : ''}
              </MetricCardDifferential>
            </MetricCardContent>
          ) : (
            <>
              <MetricCardContent>
                <MetricCardValue>
                  {creditsData ? fmtCost(creditsData.historical.totalSpend) : '—'}
                </MetricCardValue>
                <MetricCardDifferential variant="default">
                  {creditsData?.historical.months.length
                    ? `all time · ${creditsData.historical.months.length} months`
                    : ''}
                </MetricCardDifferential>
              </MetricCardContent>
              {creditsData && creditsData.historical.months.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="mt-1 space-y-1">
                    {creditsData.historical.months.map((m) => (
                      <div key={m.month} className="flex items-center justify-between text-[11px]">
                        <span className="text-foreground-lighter">
                          {new Date(m.month + '-01').toLocaleDateString('en-US', {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                        <span className="text-foreground font-medium tabular-nums">
                          {fmtCost(m.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </MetricCard>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Usage Value */}
        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Estimated value of all Claude Code usage this month at API rates — covered by Max 20x subscription, not billed separately">
              <TrendingUp className="mr-1 inline h-3.5 w-3.5" />
              Usage Value (MTD)
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{data ? fmtCost(monthlySpend) : '—'}</MetricCardValue>
            <MetricCardDifferential variant={monthlySpend > 0 ? 'positive' : 'default'}>
              {data ? `${fmtCost(data.totals.total_cost_usd)} all time · covered by Max` : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>

        {/* Subscriptions */}
        <MetricCard isLoading={isSubInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Fixed monthly subscription costs (Vercel, Supabase, Claude Max 20x, etc.)">
              <CreditCard className="mr-1 inline h-3.5 w-3.5" />
              Subscriptions
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{subData ? fmtCost(subData.totalMonthlyUsd) : '—'}</MetricCardValue>
            <MetricCardDifferential variant="default">
              {subData ? `/mo · ${subData.subscriptions.length} services` : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>

        {/* Actual Monthly Cost */}
        <MetricCard isLoading={isSubInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Actual monthly cost: subscriptions only — Claude Code usage is covered by Max 20x">
              <Flame className="mr-1 inline h-3.5 w-3.5" />
              Actual Cost/mo
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{subData ? fmtCost(subData.totalMonthlyUsd) : '—'}</MetricCardValue>
            <MetricCardDifferential variant="default">
              {subData ? 'Usage covered by Max 20x' : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>

        {/* Cache Hit Rate */}
        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Cache reads as % of total input — higher means more context reuse">
              <Database className="mr-1 inline h-3.5 w-3.5" />
              Cache Hit Rate
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{data ? `${cacheHitRate}%` : '—'}</MetricCardValue>
            <MetricCardDifferential variant={cacheHitRate >= 30 ? 'positive' : 'default'}>
              {cacheHitRate >= 30 ? 'Good cache utilization' : 'Low cache hits'}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>
      </div>

      {/* ── Secondary KPI row ── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Estimated savings from prompt caching vs full input pricing">
              <PiggyBank className="mr-1 inline h-3.5 w-3.5" />
              Cache Savings
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>{data ? fmtCost(cacheSavings) : '—'}</MetricCardValue>
            <MetricCardDifferential variant={cacheSavings > 0 ? 'positive' : 'default'}>
              {data && cacheHitRate > 0 ? `${cacheHitRate}% hit rate` : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Average cost per API request in selected window">
              <DollarSign className="mr-1 inline h-3.5 w-3.5" />
              Cost / Request
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent>
            <MetricCardValue>
              {data && costPerTask > 0 ? fmtCost(costPerTask) : '—'}
            </MetricCardValue>
            <MetricCardDifferential variant="default">
              {data ? `${days}-day window` : ''}
            </MetricCardDifferential>
          </MetricCardContent>
        </MetricCard>

        <MetricCard isLoading={isInitialLoad}>
          <MetricCardHeader>
            <MetricCardLabel tooltip="Model distribution by estimated cost in selected window">
              <Zap className="mr-1 inline h-3.5 w-3.5" />
              Model Mix
            </MetricCardLabel>
          </MetricCardHeader>
          <MetricCardContent className="flex-col items-start gap-1.5">
            {modelDistribution.length > 0 ? (
              <>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                  {modelDistribution.map((m) => (
                    <div
                      key={m.model}
                      className="h-full first:rounded-l-full last:rounded-r-full"
                      style={{ width: `${Math.max(m.pct, 2)}%`, backgroundColor: m.color }}
                      title={`${m.short}: ${m.pct}%`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {modelDistribution.map((m) => (
                    <span
                      key={m.model}
                      className="text-foreground-lighter inline-flex items-center gap-1 text-[10px]"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                      {m.short} {m.pct}%
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <MetricCardValue>—</MetricCardValue>
            )}
          </MetricCardContent>
        </MetricCard>
      </div>

      {/* ── Daily usage by model (grouped bars) ── */}
      <ChartCard isLoading={isInitialLoad}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <h3 className="text-foreground text-sm font-medium">Daily Usage by Model</h3>
            <p className="text-foreground-lighter mt-0.5 text-xs">
              Estimated value at API rates (covered by Max)
            </p>
          </div>
          <div className="border-border flex items-center rounded-md border">
            {(['weekly', 'monthly'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setChartRange(v)}
                className={`cursor-pointer px-2.5 py-1 text-[10px] font-semibold transition-colors first:rounded-l-[5px] last:rounded-r-[5px] ${
                  chartRange === v
                    ? 'bg-surface-200 text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
                }`}
              >
                {v === 'weekly' ? '7d' : '30d'}
              </button>
            ))}
          </div>
        </div>
        <ChartContent
          height={280}
          isEmpty={!isInitialLoad && dailyStacked.length === 0}
          emptyMessage="No usage data recorded yet"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyStacked} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-default)"
                vertical={false}
              />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                axisLine={false}
                tickLine={false}
                interval={chartRange === 'monthly' ? 'preserveStartEnd' : 0}
              />
              <YAxis
                tickFormatter={(v: number) => `$${v.toFixed(3)}`}
                tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip
                formatter={(value: number, name: string) => [fmtCost(value), name]}
                contentStyle={TOOLTIP_STYLE}
              />
              {uniqueModels.map((model) => (
                <Bar
                  key={model}
                  dataKey={model}
                  fill={
                    MODEL_COLOR_MAP[
                      Object.keys(MODEL_COLOR_MAP).find((k) => modelShortName(k) === model) ?? ''
                    ] ?? '#6B7280'
                  }
                  radius={[3, 3, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartContent>
      </ChartCard>

      {/* ── Per-agent cost bar + cost trend line ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Per-agent horizontal bar */}
        <ChartCard isLoading={isInitialLoad}>
          <ChartHeader title="Usage by Agent" />
          <ChartContent
            height={Math.max(200, (data?.by_agent.length ?? 0) * 44 + 40)}
            isEmpty={!isInitialLoad && (data?.by_agent.length ?? 0) === 0}
            emptyMessage="No agent data yet"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data?.by_agent ?? []}
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
                  tickFormatter={(v: number) => `$${v.toFixed(3)}`}
                  tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="agent_name"
                  tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                  axisLine={false}
                  tickLine={false}
                  width={72}
                />
                <Tooltip
                  formatter={(value: number) => [fmtCost(value), 'Cost']}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar
                  dataKey="total_cost_usd"
                  radius={[0, 3, 3, 0]}
                  fill="hsl(var(--brand-default))"
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartContent>
        </ChartCard>

        {/* Cost trend line */}
        <LineChartCard
          data={trendData}
          dataKey="cost"
          categoryKey="day"
          config={{
            cost: {
              label: 'Daily Usage (USD)',
              color: '#34B27B',
            },
          }}
          title="Usage Trend"
          metric="Daily estimated value (30 days)"
          showArea
          showGrid
          showDots
          height={Math.max(200, (data?.by_agent.length ?? 0) * 44 + 40)}
          isLoading={isInitialLoad}
          isEmpty={!isInitialLoad && trendData.length === 0}
          emptyMessage="No trend data yet"
        />
      </div>

      {/* ── Usage by model (colored horizontal bars) ── */}
      <ChartCard isLoading={isInitialLoad}>
        <ChartHeader title="Usage by Model" />
        <ChartContent
          height={Math.max(120, (data?.by_model.length ?? 0) * 44 + 40)}
          isEmpty={!isInitialLoad && (data?.by_model.length ?? 0) === 0}
          emptyMessage="No model data yet"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data?.by_model ?? []}
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
                tickFormatter={(v: number) => `$${v.toFixed(3)}`}
                tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="model"
                tickFormatter={modelShortName}
                tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                axisLine={false}
                tickLine={false}
                width={72}
              />
              <Tooltip
                formatter={(value: number) => [fmtCost(value), 'Cost']}
                labelFormatter={modelShortName}
                contentStyle={TOOLTIP_STYLE}
              />
              <Bar dataKey="total_cost_usd" radius={[0, 3, 3, 0]}>
                {(data?.by_model ?? []).map((entry) => (
                  <Cell key={entry.model} fill={modelColor(entry.model)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContent>
      </ChartCard>

      {/* ── Subscriptions section ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Subscription list */}
        <div className="border-border bg-surface-75 overflow-hidden rounded-lg border">
          <div className="px-4 py-3">
            <h3 className="text-foreground text-sm font-medium">Monthly Subscriptions</h3>
            <p className="text-foreground-lighter mt-0.5 text-xs">Fixed monthly service costs</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border border-t text-left">
                  <th className="text-foreground-lighter px-4 py-2.5 text-xs font-medium">
                    Service
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-xs font-medium">
                    Category
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-right text-xs font-medium">
                    Monthly
                  </th>
                </tr>
              </thead>
              <tbody>
                {isSubInitialLoad
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-border border-t">
                        <td className="px-4 py-2.5">
                          <div className="bg-surface-300 h-3 w-28 animate-pulse rounded" />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="bg-surface-300 h-3 w-20 animate-pulse rounded" />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="bg-surface-300 ml-auto h-3 w-12 animate-pulse rounded" />
                        </td>
                      </tr>
                    ))
                  : (subData?.subscriptions ?? []).map((s) => (
                      <tr key={s.id} className="border-border border-t">
                        <td className="px-4 py-2.5">
                          <div>
                            <span className="text-foreground text-xs font-medium">{s.name}</span>
                            {s.notes && (
                              <p className="text-foreground-lighter mt-0.5 text-[10px] leading-snug">
                                {s.notes}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              background: `${CATEGORY_COLORS[s.category] ?? '#6B7280'}20`,
                              color: CATEGORY_COLORS[s.category] ?? '#6B7280',
                            }}
                          >
                            {CATEGORY_LABELS[s.category] ?? s.category}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {s.monthlyUsd > 0 ? (
                            <span className="text-foreground text-xs font-medium tabular-nums">
                              {fmtCost(s.monthlyUsd)}
                            </span>
                          ) : (
                            <span className="text-foreground-lighter text-xs">Pay-as-go</span>
                          )}
                        </td>
                      </tr>
                    ))}
              </tbody>
              {subData && (
                <tfoot>
                  <tr className="border-border border-t">
                    <td
                      className="text-foreground-lighter px-4 py-2.5 text-xs font-medium"
                      colSpan={2}
                    >
                      Total fixed /mo
                    </td>
                    <td className="text-foreground px-4 py-2.5 text-right text-xs font-semibold tabular-nums">
                      {fmtCost(subData.totalMonthlyUsd)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Subscription breakdown chart */}
        <ChartCard isLoading={isSubInitialLoad}>
          <ChartHeader title="Subscriptions by Category" metric="Monthly fixed costs (USD)" />
          <ChartContent
            height={Math.max(160, subCategoryData.length * 48 + 40)}
            isEmpty={!isSubInitialLoad && subCategoryData.length === 0}
            emptyMessage="No subscription data"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={subCategoryData}
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
                  tickFormatter={(v: number) => `$${v}`}
                  tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                  axisLine={false}
                  tickLine={false}
                  width={100}
                />
                <Tooltip
                  formatter={(value: number) => [fmtCost(value), 'Monthly']}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="amount" radius={[0, 3, 3, 0]}>
                  {subCategoryData.map((entry) => (
                    <Cell key={entry.category} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContent>
        </ChartCard>
      </div>

      {/* ── Voice Usage ── */}
      <div className="space-y-4">
        <h2 className="text-foreground text-sm font-semibold">Voice Usage</h2>

        {/* KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard isLoading={isElInitialLoad}>
            <MetricCardHeader>
              <MetricCardLabel tooltip="Characters used vs plan limit this billing period">
                <Mic className="mr-1 inline h-3.5 w-3.5" />
                Characters Used
              </MetricCardLabel>
            </MetricCardHeader>
            <MetricCardContent>
              <MetricCardValue>
                {elSub ? elSub.character_count.toLocaleString() : '—'}
              </MetricCardValue>
              <MetricCardDifferential variant={elQuotaStatus === 'over' ? 'negative' : 'default'}>
                {elSub ? `/ ${elSub.character_limit.toLocaleString()} · ${elQuotaPct}%` : ''}
              </MetricCardDifferential>
            </MetricCardContent>
          </MetricCard>

          <MetricCard isLoading={isElInitialLoad}>
            <MetricCardHeader>
              <MetricCardLabel tooltip="Remaining characters and days until quota resets">
                <PiggyBank className="mr-1 inline h-3.5 w-3.5" />
                Quota Remaining
              </MetricCardLabel>
            </MetricCardHeader>
            <MetricCardContent>
              <MetricCardValue>{elSub ? elRemaining.toLocaleString() : '—'}</MetricCardValue>
              <MetricCardDifferential variant="default">
                {elSub ? `Resets in ${elResetDays} days` : ''}
              </MetricCardDifferential>
            </MetricCardContent>
          </MetricCard>

          <MetricCard isLoading={isElInitialLoad}>
            <MetricCardHeader>
              <MetricCardLabel tooltip="Voice slots used vs plan limit">
                <Volume2 className="mr-1 inline h-3.5 w-3.5" />
                Voice Slots
              </MetricCardLabel>
            </MetricCardHeader>
            <MetricCardContent>
              <MetricCardValue>
                {elSub ? `${elSub.voice_slots_used} / ${elSub.voice_limit}` : '—'}
              </MetricCardValue>
              <MetricCardDifferential variant="default">
                {elSub && elSub.professional_voice_limit > 0
                  ? `${elSub.professional_voice_slots_used} / ${elSub.professional_voice_limit} professional`
                  : ''}
              </MetricCardDifferential>
            </MetricCardContent>
          </MetricCard>

          <MetricCard isLoading={isElInitialLoad}>
            <MetricCardHeader>
              <MetricCardLabel tooltip="Voice provider plan tier and billing period">
                <CreditCard className="mr-1 inline h-3.5 w-3.5" />
                Plan & Status
              </MetricCardLabel>
            </MetricCardHeader>
            <MetricCardContent>
              <MetricCardValue>{elSub ? elSub.tier : '—'}</MetricCardValue>
              <MetricCardDifferential variant="default">
                {elSub ? `${elSub.billing_period} · ${elSub.status}` : ''}
              </MetricCardDifferential>
            </MetricCardContent>
          </MetricCard>
        </div>

        {/* Quota Progress Bar */}
        {elSub && (
          <div className="border-border bg-surface-75 rounded-lg border px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-foreground text-xs font-medium">Character Quota</span>
              <span className="text-foreground-lighter text-xs tabular-nums">
                {elSub.character_count.toLocaleString()} / {elSub.character_limit.toLocaleString()}{' '}
                characters
              </span>
            </div>
            <LimitBar pct={elQuotaPct} status={elQuotaStatus} />
            {elQuotaPct > 0 && (
              <p className="text-foreground-lighter mt-1.5 text-[10px]">
                {elQuotaPct}% used
                {elQuotaStatus === 'warn' && (
                  <span className="ml-1 text-amber-400">— approaching limit</span>
                )}
                {elQuotaStatus === 'over' && (
                  <span className="ml-1 text-red-400">— over limit</span>
                )}
              </p>
            )}
          </div>
        )}

        {/* Daily Character Usage Chart */}
        <ChartCard isLoading={isElInitialLoad}>
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div>
              <h3 className="text-foreground text-sm font-medium">Daily Character Usage</h3>
              <p className="text-foreground-lighter mt-0.5 text-xs">TTS characters per day</p>
            </div>
            <div className="border-border flex items-center rounded-md border">
              {(['weekly', 'monthly'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setChartRange(v)}
                  className={`cursor-pointer px-2.5 py-1 text-[10px] font-semibold transition-colors first:rounded-l-[5px] last:rounded-r-[5px] ${
                    chartRange === v
                      ? 'bg-surface-200 text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
                  }`}
                >
                  {v === 'weekly' ? '7d' : '30d'}
                </button>
              ))}
            </div>
          </div>
          <ChartContent
            height={240}
            isEmpty={!isElInitialLoad && elDailyChart.length === 0}
            emptyMessage="No voice usage data yet"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={elDailyChart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border-default)"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                  axisLine={false}
                  tickLine={false}
                  interval={chartRange === 'monthly' ? 'preserveStartEnd' : 0}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                  tick={{ fontSize: 11, fill: 'var(--foreground-lighter)' }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(value: number) => [`${value.toLocaleString()} chars`, 'Characters']}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="characters" fill="hsl(var(--brand-default))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContent>
        </ChartCard>
      </div>

      {/* ── Usage Limits section ── */}
      <div className="border-border bg-surface-75 overflow-hidden rounded-lg border">
        <div className="px-4 py-3">
          <h3 className="text-foreground text-sm font-medium">Usage vs Limits</h3>
          <p className="text-foreground-lighter mt-0.5 text-xs">
            Live usage against plan limits. Gray bars indicate data not yet available.
          </p>
        </div>
        <div className="divide-border divide-y">
          {isLimitsInitialLoad
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <div className="bg-surface-300 h-4 w-4 animate-pulse rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="flex justify-between">
                      <div className="bg-surface-300 h-3 w-32 animate-pulse rounded" />
                      <div className="bg-surface-300 h-3 w-16 animate-pulse rounded" />
                    </div>
                    <div className="bg-surface-300 h-1.5 w-full animate-pulse rounded-full" />
                  </div>
                </div>
              ))
            : (limitsData?.limits ?? []).map((limit) => (
                <div key={limit.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5 shrink-0">
                    <LimitStatusIcon status={limit.status} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-foreground text-xs font-medium">{limit.name}</span>
                        <span className="text-foreground-lighter ml-2 text-[10px] capitalize">
                          {limit.category}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        {limit.used !== null ? (
                          <span className="text-foreground text-xs font-medium tabular-nums">
                            {limit.unit === 'USD'
                              ? fmtCost(limit.used)
                              : `${limit.used.toLocaleString()} ${limit.unit}`}
                            {limit.limit !== null && (
                              <span className="text-foreground-lighter font-normal">
                                {' / '}
                                {limit.unit === 'USD'
                                  ? fmtCost(limit.limit)
                                  : `${limit.limit.toLocaleString()} ${limit.unit}`}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-foreground-lighter text-xs">No data</span>
                        )}
                      </div>
                    </div>
                    <LimitBar pct={limit.pct} status={limit.status} />
                    {limit.pct !== null && (
                      <p className="text-foreground-lighter text-[10px]">
                        {limit.pct}% used
                        {limit.status === 'warn' && (
                          <span className="ml-1 text-amber-400">— approaching limit</span>
                        )}
                        {limit.status === 'over' && (
                          <span className="ml-1 text-red-400">— over limit</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
