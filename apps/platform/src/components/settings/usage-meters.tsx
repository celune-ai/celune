'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';

interface UsageMetric {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  percentage: number | null;
}

interface UsageResponse {
  plan: string;
  is_platform_owner: boolean;
  metrics: UsageMetric[];
  has_warning: boolean;
}

/** Format helpers for specific metric keys */
function formatValue(key: string, value: number): string {
  if (key === 'llm_cost') return `$${value.toFixed(2)}`;
  if (key === 'storage_bytes') return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (key === 'tts_minutes') return value.toFixed(1);
  return value.toLocaleString();
}

function formatLimit(key: string, limit: number): string {
  if (key === 'llm_cost') return `$${limit.toFixed(2)}`;
  if (key === 'storage_bytes') return `${(limit / (1024 * 1024)).toFixed(1)} MB`;
  return limit.toLocaleString();
}

interface UsageMetersProps {
  workspaceId: string;
}

export function UsageMeters({ workspaceId }: UsageMetersProps) {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchJson<UsageResponse>(
        apiUrl(`/api/workspaces/usage?workspace_id=${workspaceId}`),
      );
      setData(res);
    } catch {
      toast.error('Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const { metrics } = data;

  return (
    <div className="space-y-3">
      <h3 className="text-foreground text-sm font-medium">Usage</h3>

      <div className="bg-surface-75 border-border divide-border divide-y rounded-lg border">
        {metrics.map((metric) => {
          const pct = metric.percentage ?? 0;
          const isUnlimited = metric.limit === null;
          const isWarning = !isUnlimited && pct >= 70 && pct < 90;
          const isDanger = !isUnlimited && pct >= 90;

          return (
            <div key={metric.key} className="px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-foreground text-sm">
                  {metric.label}
                  {isWarning && (
                    <span
                      className="ml-1.5 text-[10px] font-medium"
                      style={{ color: 'var(--warning-default)' }}
                    >
                      {pct}% used
                    </span>
                  )}
                  {isDanger && (
                    <span
                      className="ml-1.5 text-[10px] font-medium"
                      style={{ color: 'var(--destructive-default)' }}
                    >
                      {pct}% used
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatValue(metric.key, metric.used)} /{' '}
                  {isUnlimited ? 'Unlimited' : formatLimit(metric.key, metric.limit!)}
                </span>
              </div>

              <div
                className="bg-surface-100 h-1.5 w-full rounded-full"
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${metric.label} usage: ${isUnlimited ? 'unlimited' : `${Math.round(pct)}%`}`}
              >
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: isUnlimited ? '0%' : `${pct}%`,
                    backgroundColor: isDanger
                      ? 'var(--destructive-default)'
                      : isWarning
                        ? 'var(--warning-default)'
                        : 'var(--brand-default)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
