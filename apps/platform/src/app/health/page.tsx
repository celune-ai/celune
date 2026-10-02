'use client';

import { useEffect, useState } from 'react';
import { StatusCard } from '@/components/status-card';
import { Metric } from '@/components/metric';
import { RefreshCw } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { PageActionBar } from '@/components/page-action-bar';
import { formatTime, formatUptime } from '@/lib/date-utils';

interface HealthData {
  timestamp: string;
  heartbeat: {
    status: string;
    last_run: string | null;
    runs_today: number;
    total_runs: number;
    last_error: string | null;
  };
  feed_scanner: {
    status: string;
    scans_today: number;
    items_today: number;
    sources_active: number;
    last_scan: string | null;
  };
  slackbot: {
    status: string;
    uptime_seconds: number;
    errors_last_hour: number;
  };
  memory_db: {
    status: string;
    files_indexed: number;
    chunks_indexed: number;
    size_kb: number;
  };
  vault: {
    inbox_items: number;
    inbox_oldest_days: number;
    active_projects: number;
    session_logs: number;
    daily_notes: number;
  };
  openclaw: {
    status: string;
    latest_version: string | null;
    release_date: string | null;
    days_since_release: number | null;
    repository: string;
    error?: string;
  };
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchHealth() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/health');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <PageActionBar>
        <span className="text-foreground text-xl font-medium">System Health</span>
        <Button variant="outline" size="md" onClick={fetchHealth} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </PageActionBar>

      <div className="space-y-6 p-6">
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
            <p className="font-medium">Health check failed</p>
            <p className="mt-1 text-red-400">{error}</p>
          </div>
        )}

        {data && (
          <>
            <p className="text-foreground-lighter text-sm">
              Last checked: {formatTime(data.timestamp)}
            </p>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatusCard title="Heartbeat" status={data.heartbeat.status}>
                <Metric label="Last run" value={formatTime(data.heartbeat.last_run)} />
                <Metric label="Runs today" value={data.heartbeat.runs_today} />
                <Metric label="Total runs" value={data.heartbeat.total_runs} />
                {data.heartbeat.last_error && (
                  <p className="mt-2 text-xs text-red-400">{data.heartbeat.last_error}</p>
                )}
              </StatusCard>

              <StatusCard title="Slack Bot" status={data.slackbot.status}>
                <Metric label="Uptime" value={formatUptime(data.slackbot.uptime_seconds)} />
                <Metric label="Errors (1h)" value={data.slackbot.errors_last_hour} />
              </StatusCard>

              <StatusCard title="Memory DB" status={data.memory_db.status}>
                <Metric label="Files indexed" value={data.memory_db.files_indexed} />
                <Metric label="Chunks" value={data.memory_db.chunks_indexed} />
                <Metric label="Size" value={`${data.memory_db.size_kb} KB`} />
              </StatusCard>

              <StatusCard title="Feed Scanner" status={data.feed_scanner.status}>
                <Metric label="Scans today" value={data.feed_scanner.scans_today} />
                <Metric label="Items today" value={data.feed_scanner.items_today} />
                <Metric label="Sources" value={data.feed_scanner.sources_active} />
                <Metric label="Last scan" value={formatTime(data.feed_scanner.last_scan)} />
              </StatusCard>

              <StatusCard title="Vault" status={data.vault.inbox_items > 5 ? 'warning' : 'ok'}>
                <Metric label="Inbox items" value={data.vault.inbox_items} />
                <Metric label="Oldest (days)" value={data.vault.inbox_oldest_days} />
                <Metric label="Active projects" value={data.vault.active_projects} />
                <Metric label="Session logs" value={data.vault.session_logs} />
                <Metric label="Daily notes" value={data.vault.daily_notes} />
              </StatusCard>

              <StatusCard title="OpenClaw" status={data.openclaw.status}>
                <Metric label="Latest version" value={data.openclaw.latest_version || 'unknown'} />
                <Metric label="Released" value={formatTime(data.openclaw.release_date)} />
                {data.openclaw.days_since_release !== null && (
                  <Metric label="Days since" value={data.openclaw.days_since_release} />
                )}
                {data.openclaw.error && (
                  <p className="mt-2 text-xs text-yellow-400">{data.openclaw.error}</p>
                )}
              </StatusCard>
            </div>
          </>
        )}

        {loading && !data && (
          <div className="text-foreground-lighter py-12 text-center">Loading health data...</div>
        )}
      </div>
    </div>
  );
}
