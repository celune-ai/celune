'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Users,
  Clock,
  HeartPulse,
  AlertTriangle,
  Archive,
  Loader2,
} from 'lucide-react';
import { useWorkspace } from '@/providers/workspace-provider';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryStats {
  total: number;
  byCategory: { category: string; count: number }[];
  bySource: { source: string; count: number }[];
  newestMemory: string | null;
}

interface HealthAction {
  name: string;
  count: number;
  action: string;
}

interface MemoryHealth {
  score: number;
  total: number;
  topActions: HealthAction[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function healthScoreColor(score: number): string {
  if (score >= 80) return 'text-success';
  if (score >= 50) return 'text-warning';
  return 'text-destructive';
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function InsightsSkeleton() {
  return (
    <div className="space-y-8 p-4">
      {/* Knowledge overview skeleton */}
      <div>
        <div className="bg-surface-200 mb-2 h-3 w-24 animate-pulse rounded" />
        <div className="bg-surface-200 h-7 w-16 animate-pulse rounded" />
      </div>
      {/* Health skeleton */}
      <div>
        <div className="bg-surface-200 mb-2 h-3 w-16 animate-pulse rounded" />
        <div className="flex items-center gap-2">
          <div className="bg-surface-200 h-4 w-4 animate-pulse rounded" />
          <div className="bg-surface-200 h-5 w-12 animate-pulse rounded" />
        </div>
      </div>
      {/* Category bar skeleton */}
      <div>
        <div className="bg-surface-200 mb-2 h-3 w-32 animate-pulse rounded" />
        <div className="bg-surface-200 h-3 w-full animate-pulse rounded-full" />
      </div>
      {/* Source pills skeleton */}
      <div>
        <div className="bg-surface-200 mb-2 h-3 w-28 animate-pulse rounded" />
        <div className="flex gap-2">
          <div className="bg-surface-200 h-6 w-14 animate-pulse rounded-full" />
          <div className="bg-surface-200 h-6 w-14 animate-pulse rounded-full" />
          <div className="bg-surface-200 h-6 w-14 animate-pulse rounded-full" />
        </div>
      </div>
      {/* Timeline skeleton */}
      <div>
        <div className="bg-surface-200 mb-2 h-3 w-20 animate-pulse rounded" />
        <div className="bg-surface-200 h-4 w-36 animate-pulse rounded" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemoryInsightsPanel() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;

  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [health, setHealth] = useState<MemoryHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [cleanupError, setCleanupError] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;

    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchJson<MemoryStats>(`/api/memory/stats?workspace_id=${workspaceId}`),
      fetchJson<MemoryHealth>(`/api/memory/health?workspace_id=${workspaceId}`).catch(
        (err: unknown) => {
          console.warn('[memory-insights] Health fetch failed:', err);
          return null;
        },
      ),
    ])
      .then(([statsData, healthData]) => {
        if (!cancelled) {
          setStats(statsData);
          if (healthData) setHealth(healthData);
        }
      })
      .catch(() => {
        // Fail silently — insights are non-critical
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleCleanup = useCallback(async () => {
    if (!workspaceId || !health || archiving) return;
    setArchiving(true);
    setCleanupError(false);
    try {
      const res = await fetch(apiUrl(`/api/memory/health/cleanup?workspace_id=${workspaceId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        setCleanupError(true);
        return;
      }
      // Refresh health data
      const updated = await fetchJson<MemoryHealth>(
        `/api/memory/health?workspace_id=${workspaceId}`,
      );
      setHealth(updated);
    } catch {
      setCleanupError(true);
    } finally {
      setArchiving(false);
    }
  }, [workspaceId, health, archiving]);

  // Fail silently if no data
  if (!loading && !stats) return null;

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const categoryEntries = stats
    ? stats.byCategory
        .map((c) => [c.category, c.count] as [string, number])
        .sort(([, a], [, b]) => b - a)
    : [];

  const sourceEntries = stats
    ? stats.bySource
        .map((s) => [s.source, s.count] as [string, number])
        .sort(([, a], [, b]) => b - a)
    : [];

  return (
    <div className="bg-surface-75 rounded-lg">
      {loading ? (
        <InsightsSkeleton />
      ) : stats ? (
        <div className="space-y-8 p-4">
          {/* Knowledge Overview */}
          <section>
            <h3 className="text-foreground-lighter mb-1.5 text-xs font-medium tracking-wider uppercase">
              Overview
            </h3>
            {(() => {
              const coreCount = stats.bySource.find((s) => s.source === 'brain-seed')?.count ?? 0;
              const newCount = stats.total - coreCount;
              return (
                <div className="space-y-1">
                  {coreCount > 0 && (
                    <div className="flex items-center gap-2">
                      <Brain className="text-foreground-lighter h-4 w-4" aria-hidden="true" />
                      <span className="text-foreground text-sm font-semibold tabular-nums">
                        {coreCount.toLocaleString()}
                      </span>
                      <span className="text-foreground-lighter text-sm">
                        Core {coreCount === 1 ? 'Memory' : 'Memories'}
                      </span>
                    </div>
                  )}
                  {newCount > 0 && (
                    <div className="flex items-center gap-2">
                      <Brain className="text-success h-4 w-4" aria-hidden="true" />
                      <span className="text-foreground text-sm font-semibold tabular-nums">
                        {newCount.toLocaleString()}
                      </span>
                      <span className="text-foreground-lighter text-sm">
                        New {newCount === 1 ? 'Memory' : 'Memories'}
                      </span>
                    </div>
                  )}
                  {stats.total === 0 && (
                    <span className="text-foreground-lighter text-sm">No memories yet</span>
                  )}
                </div>
              );
            })()}
          </section>

          {/* Memory Health Score */}
          {health && health.total > 0 && (
            <section>
              <h3 className="text-foreground-lighter mb-1.5 text-xs font-medium tracking-wider uppercase">
                Health
              </h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <HeartPulse
                    className={`h-4 w-4 ${healthScoreColor(health.score)}`}
                    aria-hidden="true"
                  />
                  <span className="text-foreground text-sm font-semibold tabular-nums">
                    {health.score}
                  </span>
                  <span className="text-foreground-lighter text-sm">/ 100</span>
                </div>

                {health.topActions.length > 0 && (
                  <div className="space-y-1.5">
                    {health.topActions.map((a) => (
                      <div key={a.name} className="flex items-start gap-1.5">
                        <AlertTriangle
                          className="text-warning mt-0.5 h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="text-foreground-muted text-xs leading-relaxed">
                          {a.action}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {health.topActions.some(
                  (a) => a.name === 'Stale Memories' || a.name === 'Low-Importance Clutter',
                ) && (
                  <button
                    onClick={handleCleanup}
                    disabled={archiving}
                    aria-label="Auto-archive stale and low-importance memories"
                    className="text-foreground-lighter hover:text-foreground focus-visible:ring-ring mt-1 flex items-center gap-1 rounded text-xs transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
                  >
                    {archiving ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    ) : (
                      <Archive className="h-3 w-3" aria-hidden="true" />
                    )}
                    {archiving ? 'Cleaning up...' : 'Auto-archive stale & clutter'}
                  </button>
                )}

                {cleanupError && (
                  <p className="text-destructive text-xs">Cleanup failed. Try again later.</p>
                )}
              </div>
            </section>
          )}

          {/* Learning Velocity — approximate from total and latest update */}
          {stats.total > 0 && (
            <section>
              <h3 className="text-foreground-lighter mb-1.5 text-xs font-medium tracking-wider uppercase">
                Velocity
              </h3>
              <div className="flex items-center gap-2">
                {stats.total >= 10 ? (
                  <TrendingUp className="text-brand h-4 w-4" aria-hidden="true" />
                ) : (
                  <TrendingDown className="text-foreground-lighter h-4 w-4" aria-hidden="true" />
                )}
                <span className="text-foreground text-sm">
                  <span className="font-semibold tabular-nums">{stats.total.toLocaleString()}</span>{' '}
                  total across{' '}
                  <span className="font-semibold tabular-nums">{categoryEntries.length}</span>{' '}
                  {categoryEntries.length === 1 ? 'category' : 'categories'}
                </span>
              </div>
            </section>
          )}

          {/* Top Agents — derived from source = agent count */}
          {sourceEntries.some(([src]) => src === 'agent') && (
            <section>
              <h3 className="text-foreground-lighter mb-1.5 text-xs font-medium tracking-wider uppercase">
                Contributions
              </h3>
              <div className="flex items-center gap-2">
                <Users className="text-foreground-lighter h-4 w-4" aria-hidden="true" />
                <span className="text-foreground text-sm">
                  Agents contributed{' '}
                  <span className="font-semibold tabular-nums">
                    {(
                      stats.bySource.find((s) => s.source === 'agent')?.count ?? 0
                    ).toLocaleString()}
                  </span>{' '}
                  {(stats.bySource.find((s) => s.source === 'agent')?.count ?? 0) === 1
                    ? 'memory'
                    : 'memories'}
                </span>
              </div>
            </section>
          )}

          {/* Timeline */}
          {stats.newestMemory && (
            <section>
              <h3 className="text-foreground-lighter mb-1.5 text-xs font-medium tracking-wider uppercase">
                Timeline
              </h3>
              <div className="flex items-center gap-2">
                <Clock className="text-foreground-lighter h-4 w-4" aria-hidden="true" />
                <span className="text-foreground-muted text-xs">
                  Latest: {formatDate(stats.newestMemory)}
                </span>
              </div>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}
