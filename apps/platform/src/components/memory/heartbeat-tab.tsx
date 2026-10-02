'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Heart,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Shield,
  Timer,
  XCircle,
  Zap,
} from 'lucide-react';
import { Switch } from '@repo/ui/components/switch';
import { Badge } from '@repo/ui/components/badge';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { CollectingZeroState } from '@/components/collecting-zero-state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeartbeatAgent {
  agent_name: string;
  display_name: string;
  status: string;
  last_heartbeat: string | null;
  current_task_id: string | null;
  model: string | null;
  color: string;
  role: string;
}

interface HeartbeatEvent {
  id: string;
  agent_id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface HeartbeatMetrics {
  total_sessions_today: number;
  stale_resets_today: number;
  uptime_pct: number;
  total_agents: number;
  active_agents: number;
}

interface HeartbeatResponse {
  agents: HeartbeatAgent[];
  events: HeartbeatEvent[];
  metrics: HeartbeatMetrics;
  page: number;
  has_more: boolean;
}

interface CronJob {
  job_id: string;
  display_name: string;
  schedule_description: string | null;
  schedule_seconds: number | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_error: string | null;
  enabled: boolean;
  updated_at: string | null;
}

// Local settings stored in localStorage
interface MonitorSettings {
  [key: string]: { enabled: boolean; channels: string[] };
}

// ---------------------------------------------------------------------------
// Monitor definitions
// ---------------------------------------------------------------------------

interface MonitorDef {
  key: string;
  label: string;
  description: string;
  icon: typeof Activity;
  eventTypes: string[]; // which heartbeat event_types this monitor covers
  defaultEnabled: boolean;
}

const MONITORS: MonitorDef[] = [
  {
    key: 'agent_status',
    label: 'Agent Status Changes',
    description: 'Get notified when agents come online, go offline, or become idle.',
    icon: Bot,
    eventTypes: ['online', 'offline', 'idle'],
    defaultEnabled: true,
  },
  {
    key: 'stale_alerts',
    label: 'Stale Agent Alerts',
    description: 'Alert when an agent stops responding and gets automatically reset.',
    icon: AlertTriangle,
    eventTypes: ['stale_reset', 'alert_fired'],
    defaultEnabled: true,
  },
  {
    key: 'task_activity',
    label: 'Task Activity',
    description: 'Track when agents start and complete tasks.',
    icon: Zap,
    eventTypes: ['task_started', 'task_completed', 'working'],
    defaultEnabled: true,
  },
  {
    key: 'health_checks',
    label: 'Health Checks',
    description: 'Periodic health check pings and system status reports.',
    icon: Heart,
    eventTypes: ['health_check'],
    defaultEnabled: false,
  },
];

const AVAILABLE_CHANNELS = [
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'slack', label: 'Slack', icon: MessageSquare },
] as const;

// ---------------------------------------------------------------------------
// Settings persistence (localStorage per workspace)
// ---------------------------------------------------------------------------

function loadSettings(workspaceId: string): MonitorSettings {
  try {
    const raw = localStorage.getItem(`celune:heartbeat:${workspaceId}`);
    if (raw) return JSON.parse(raw) as MonitorSettings;
  } catch {
    /* ignore */
  }
  // Defaults
  const defaults: MonitorSettings = {};
  for (const m of MONITORS) {
    defaults[m.key] = { enabled: m.defaultEnabled, channels: ['email'] };
  }
  return defaults;
}

function saveSettings(workspaceId: string, settings: MonitorSettings) {
  try {
    localStorage.setItem(`celune:heartbeat:${workspaceId}`, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  online: { label: 'Online', color: 'text-green-400', dot: 'bg-green-400' },
  working: { label: 'Working', color: 'text-blue-400', dot: 'bg-blue-400' },
  idle: { label: 'Idle', color: 'text-yellow-400', dot: 'bg-yellow-400' },
  offline: { label: 'Offline', color: 'text-foreground-muted', dot: 'bg-foreground-muted' },
};

function StatusDot({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  return (
    <span className="relative flex h-2 w-2">
      {(status === 'online' || status === 'working') && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${config.dot}`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${config.dot}`} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Event type display
// ---------------------------------------------------------------------------

const EVENT_LABELS: Record<string, { label: string; icon: typeof Activity }> = {
  online: { label: 'Came online', icon: Zap },
  offline: { label: 'Went offline', icon: Clock },
  working: { label: 'Started working', icon: Activity },
  idle: { label: 'Went idle', icon: Clock },
  stale_reset: { label: 'Stale reset', icon: AlertTriangle },
  task_started: { label: 'Task started', icon: Zap },
  task_completed: { label: 'Task completed', icon: Activity },
  alert_fired: { label: 'Alert fired', icon: AlertTriangle },
  health_check: { label: 'Health check', icon: Heart },
};

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Monitor settings card
// ---------------------------------------------------------------------------

function MonitorCard({
  monitor,
  settings,
  onToggle,
  onToggleChannel,
  hasSlack,
}: {
  monitor: MonitorDef;
  settings: { enabled: boolean; channels: string[] };
  onToggle: () => void;
  onToggleChannel: (channel: string) => void;
  hasSlack: boolean;
}) {
  const Icon = monitor.icon;

  return (
    <div
      className={`border-border bg-surface-100 rounded-lg border p-4 transition-opacity ${!settings.enabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="bg-brand/10 flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
            <Icon className="text-brand h-4 w-4" />
          </div>
          <div>
            <p className="text-foreground text-sm font-medium">{monitor.label}</p>
            <p className="text-foreground-lighter mt-0.5 text-xs">{monitor.description}</p>
          </div>
        </div>
        <Switch checked={settings.enabled} onCheckedChange={onToggle} />
      </div>

      {settings.enabled && (
        <div className="border-border mt-3 border-t pt-3">
          <label className="text-foreground-lighter mb-2 block text-xs">Notify via</label>
          <div className="flex items-center gap-3">
            {AVAILABLE_CHANNELS.map((ch) => {
              const ChIcon = ch.icon;
              const active = settings.channels.includes(ch.key);
              const disabled = ch.key === 'slack' && !hasSlack;
              return (
                <button
                  key={ch.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggleChannel(ch.key)}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    active
                      ? 'border-brand/40 bg-brand/10 text-brand'
                      : 'border-border text-foreground-lighter hover:border-border-stronger'
                  } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <ChIcon className="h-3 w-3" />
                  {ch.label}
                  {disabled && (
                    <span className="text-foreground-muted ml-0.5 text-[10px]">
                      (not connected)
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent status card
// ---------------------------------------------------------------------------

function AgentStatusCard({ agent }: { agent: HeartbeatAgent }) {
  const config = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.offline;

  return (
    <div className="border-border bg-surface-75 flex items-center gap-3 rounded-lg border p-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: agent.color }}
      >
        <Bot className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusDot status={agent.status} />
          <span className="text-foreground truncate text-sm font-medium">{agent.display_name}</span>
          <span className={`text-xs ${config.color}`}>{config.label}</span>
        </div>
        <div className="text-foreground-lighter mt-0.5 flex items-center gap-2 text-xs">
          <span>{agent.role}</span>
          {agent.last_heartbeat && (
            <>
              <span className="text-foreground-muted">·</span>
              <span>{timeAgo(agent.last_heartbeat)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  icon: Icon,
  color = 'text-foreground',
}: {
  label: string;
  value: string | number;
  icon: typeof Activity;
  color?: string;
}) {
  return (
    <div className="border-border bg-surface-75 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-foreground-lighter text-xs">{label}</span>
      </div>
      <div className={`text-foreground mt-1 text-2xl font-semibold tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: HeartbeatEvent }) {
  const config = EVENT_LABELS[event.event_type] ?? {
    label: event.event_type,
    icon: Activity,
  };
  const Icon = config.icon;
  const taskTitle =
    (event.metadata?.task_title as string) ?? (event.metadata?.task_id as string) ?? null;

  return (
    <div className="border-border flex items-start gap-3 border-b px-1 py-2.5 last:border-b-0">
      <Icon className="text-foreground-lighter mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">{event.agent_id}</span>
          <span className="text-foreground-lighter text-xs">{config.label}</span>
        </div>
        {taskTitle && (
          <p className="text-foreground-lighter mt-0.5 truncate text-xs">{taskTitle}</p>
        )}
      </div>
      <span className="text-foreground-muted shrink-0 text-xs">{timeAgo(event.created_at)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduled job card
// ---------------------------------------------------------------------------

function ScheduledJobCard({
  job,
  onToggle,
}: {
  job: CronJob;
  onToggle: (jobId: string, enabled: boolean) => void;
}) {
  const statusIcon =
    job.last_run_status === 'success' ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
    ) : job.last_run_status === 'failure' ? (
      <XCircle className="h-3.5 w-3.5 text-red-400" />
    ) : job.last_run_status === 'running' ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
    ) : (
      <Clock className="text-foreground-muted h-3.5 w-3.5" />
    );

  const scheduleLabel =
    job.schedule_description ??
    (job.schedule_seconds
      ? job.schedule_seconds >= 3600
        ? `Every ${Math.round(job.schedule_seconds / 3600)}h`
        : `Every ${Math.round(job.schedule_seconds / 60)}m`
      : 'Manual');

  return (
    <div
      className={`border-border bg-surface-100 rounded-lg border p-4 transition-opacity ${!job.enabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="bg-brand/10 flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
            <Timer className="text-brand h-4 w-4" />
          </div>
          <div>
            <p className="text-foreground text-sm font-medium">{job.display_name}</p>
            <div className="text-foreground-lighter mt-0.5 flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {scheduleLabel}
              </span>
              {job.last_run_at && (
                <>
                  <span className="text-foreground-muted">·</span>
                  <span className="flex items-center gap-1">
                    {statusIcon}
                    {timeAgo(job.last_run_at)}
                  </span>
                </>
              )}
            </div>
            {job.last_error && job.last_run_status === 'failure' && (
              <p className="mt-1 line-clamp-1 text-xs text-red-400">{job.last_error}</p>
            )}
          </div>
        </div>
        <Switch
          checked={job.enabled}
          onCheckedChange={(checked) => onToggle(job.job_id, checked)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HeartbeatTab({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<HeartbeatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState<MonitorSettings>(() => loadSettings(workspaceId));
  const [hasSlack, setHasSlack] = useState(false);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronLoading, setCronLoading] = useState(true);

  // Check Slack connection status
  useEffect(() => {
    fetchJson<{ connected: boolean }>(
      apiUrl(`/api/notifications/slack/status?workspace_id=${workspaceId}`),
    )
      .then((res) => setHasSlack(res.connected))
      .catch(() => setHasSlack(false));
  }, [workspaceId]);

  // Fetch cron jobs
  const fetchCronJobs = useCallback(async () => {
    setCronLoading(true);
    try {
      const res = await fetchJson<{ jobs: CronJob[] }>(
        apiUrl(`/api/cron/jobs?workspace_id=${workspaceId}`),
      );
      setCronJobs(res.jobs);
    } catch {
      // silently fail
    } finally {
      setCronLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchCronJobs();
  }, [fetchCronJobs]);

  async function toggleCronJob(jobId: string, enabled: boolean) {
    // Optimistic update
    setCronJobs((prev) => prev.map((j) => (j.job_id === jobId ? { ...j, enabled } : j)));
    try {
      await fetchJson(apiUrl(`/api/cron/jobs?workspace_id=${workspaceId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, enabled }),
      });
    } catch {
      // Revert on failure
      setCronJobs((prev) =>
        prev.map((j) => (j.job_id === jobId ? { ...j, enabled: !enabled } : j)),
      );
    }
  }

  const fetchData = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetchJson<HeartbeatResponse>(
          `/api/memory/heartbeat?workspace_id=${workspaceId}`,
        );
        setData(res);
      } catch {
        // silently fail — empty state will show
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  function updateSettings(next: MonitorSettings) {
    setSettings(next);
    saveSettings(workspaceId, next);
  }

  function toggleMonitor(key: string) {
    const current = settings[key] ?? { enabled: false, channels: ['email'] };
    updateSettings({ ...settings, [key]: { ...current, enabled: !current.enabled } });
  }

  function toggleChannel(monitorKey: string, channel: string) {
    const current = settings[monitorKey] ?? { enabled: true, channels: ['email'] };
    const channels = current.channels.includes(channel)
      ? current.channels.filter((c) => c !== channel)
      : [...current.channels, channel];
    // Must have at least one channel if enabled
    if (channels.length === 0) return;
    updateSettings({ ...settings, [monitorKey]: { ...current, channels } });
  }

  // Build set of enabled event types for filtering the timeline
  const enabledEventTypes = new Set<string>();
  for (const monitor of MONITORS) {
    const s = settings[monitor.key];
    if (s?.enabled) {
      for (const et of monitor.eventTypes) enabledEventTypes.add(et);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="text-foreground-lighter h-6 w-6 animate-spin" />
      </div>
    );
  }

  const hasData = data && data.agents.length > 0;
  const filteredEvents = data?.events.filter((e) => enabledEventTypes.has(e.event_type)) ?? [];

  return (
    <div className="space-y-8">
      {/* ── Monitoring Settings ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-foreground flex items-center gap-2 text-sm font-medium">
              <Shield className="h-4 w-4" />
              Monitoring
            </h2>
            <p className="text-foreground-lighter mt-1 text-xs">
              Configure which agent events you monitor and how you get notified.
            </p>
          </div>
          {hasData && (
            <button
              type="button"
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="text-foreground-lighter hover:text-foreground inline-flex items-center gap-1.5 text-xs transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MONITORS.map((monitor) => (
            <MonitorCard
              key={monitor.key}
              monitor={monitor}
              settings={
                settings[monitor.key] ?? { enabled: monitor.defaultEnabled, channels: ['email'] }
              }
              onToggle={() => toggleMonitor(monitor.key)}
              onToggleChannel={(ch) => toggleChannel(monitor.key, ch)}
              hasSlack={hasSlack}
            />
          ))}
        </div>
      </section>

      {/* ── Scheduled Tasks ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-foreground flex items-center gap-2 text-sm font-medium">
            <Timer className="h-4 w-4" />
            Scheduled Tasks
          </h2>
          <p className="text-foreground-lighter mt-1 text-xs">
            Automated background jobs running on a schedule for this workspace.
          </p>
        </div>

        {cronLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-foreground-lighter h-5 w-5 animate-spin" />
          </div>
        ) : cronJobs.length === 0 ? (
          <p className="text-foreground-lighter py-4 text-sm">
            No scheduled tasks configured for this workspace.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {cronJobs.map((job) => (
              <ScheduledJobCard key={job.job_id} job={job} onToggle={toggleCronJob} />
            ))}
          </div>
        )}
      </section>

      {!hasData ? (
        <CollectingZeroState
          title="No heartbeat data yet"
          description="Heartbeat data appears once agents start reporting their status. Start working on tasks to generate activity."
        />
      ) : (
        <>
          {/* ── Metrics ── */}
          <section>
            <h3 className="text-foreground-lighter mb-3 text-xs font-medium tracking-wider uppercase">
              Overview
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                label="Uptime"
                value={`${data.metrics.uptime_pct}%`}
                icon={Activity}
                color={data.metrics.uptime_pct >= 80 ? 'text-green-400' : 'text-yellow-400'}
              />
              <MetricCard
                label="Active"
                value={`${data.metrics.active_agents}/${data.metrics.total_agents}`}
                icon={Zap}
                color="text-blue-400"
              />
              <MetricCard
                label="Sessions Today"
                value={data.metrics.total_sessions_today}
                icon={Clock}
              />
              <MetricCard
                label="Stale Resets"
                value={data.metrics.stale_resets_today}
                icon={AlertTriangle}
                color={
                  data.metrics.stale_resets_today > 0
                    ? 'text-yellow-400'
                    : 'text-foreground-lighter'
                }
              />
            </div>
          </section>

          {/* ── Agent Status Grid ── */}
          <section>
            <h3 className="text-foreground-lighter mb-3 text-xs font-medium tracking-wider uppercase">
              Agent Status
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.agents.map((agent) => (
                <AgentStatusCard key={agent.agent_name} agent={agent} />
              ))}
            </div>
          </section>

          {/* ── Activity Timeline (filtered by enabled monitors) ── */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-foreground-lighter text-xs font-medium tracking-wider uppercase">
                Activity Timeline
              </h3>
              {enabledEventTypes.size < 9 && (
                <Badge variant="muted" className="text-xs">
                  Filtered by enabled monitors
                </Badge>
              )}
            </div>
            {filteredEvents.length === 0 ? (
              <p className="text-foreground-lighter text-sm">
                {enabledEventTypes.size === 0
                  ? 'Enable a monitor above to see activity.'
                  : 'No recent activity for enabled monitors.'}
              </p>
            ) : (
              <div className="border-border rounded-lg border p-3">
                {filteredEvents.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
