'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Play,
  CheckCircle2,
  AlertCircle,
  Eye,
  User,
  Activity,
  ArrowRight,
  MessageSquare,
} from 'lucide-react';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { AGENT_COLORS } from '../../lib/agent-colors';
import { formatRelativeTime } from '../../lib/date-utils';
import { useCelune } from '../../provider/context';
import type { Task, TaskMetadata } from './types';
import type { ActivityEntry } from '@repo/types';

const LABEL_COLOR = 'var(--celune-fg-muted)';

interface TimelineEvent {
  id: string;
  timestamp: string;
  icon: React.ReactNode;
  color: string;
  label: string;
  agent?: string;
  detail?: string;
}

interface TaskDrawerTimelineProps {
  task: Task;
}

/** Build lifecycle events from task metadata timestamps */
function deriveLifecycleEvents(task: Task): TimelineEvent[] {
  const meta = (task.metadata ?? {}) as TaskMetadata;
  const labels = TASK_ASSIGNEE_LABELS as Record<string, string>;
  const events: TimelineEvent[] = [];

  events.push({
    id: 'created',
    timestamp: task.created_at,
    icon: <Activity className="h-3 w-3" />,
    color: 'var(--foreground-lighter)',
    label: 'Task created',
  });

  if (meta.claimed_at && meta.claimed_by) {
    events.push({
      id: 'claimed',
      timestamp: meta.claimed_at,
      icon: <User className="h-3 w-3" />,
      color: 'var(--celune-status-scoping)',
      label: 'Claimed',
      agent: labels[meta.claimed_by] ?? meta.claimed_by,
    });
  }

  if (meta.scoping_started_at && meta.scoped_by) {
    events.push({
      id: 'scoping',
      timestamp: meta.scoping_started_at,
      icon: <Eye className="h-3 w-3" />,
      color: 'var(--celune-status-planning)',
      label: 'Scoping started',
      agent: labels[meta.scoped_by] ?? meta.scoped_by,
    });
  }

  if (meta.work_started_at) {
    events.push({
      id: 'work-started',
      timestamp: meta.work_started_at,
      icon: <Play className="h-3 w-3" />,
      color: 'var(--celune-status-done)',
      label: 'Work started',
      agent: meta.initiated_by ? (labels[meta.initiated_by] ?? meta.initiated_by) : undefined,
    });
  }

  if (meta.blocked_at) {
    events.push({
      id: 'blocked',
      timestamp: meta.blocked_at,
      icon: <AlertCircle className="h-3 w-3" />,
      color: 'var(--celune-danger)',
      label: 'Blocked',
      detail: meta.blocked_reason ?? undefined,
    });
  }

  if (meta.auto_unblocked_at) {
    events.push({
      id: 'unblocked',
      timestamp: meta.auto_unblocked_at,
      icon: <CheckCircle2 className="h-3 w-3" />,
      color: 'var(--celune-status-done)',
      label: 'Unblocked',
    });
  }

  if (meta.review_requested_at && meta.review_requested_by) {
    events.push({
      id: 'review-requested',
      timestamp: meta.review_requested_at,
      icon: <Eye className="h-3 w-3" />,
      color: 'var(--celune-status-review)',
      label: 'Review requested',
      agent: labels[meta.review_requested_by] ?? meta.review_requested_by,
    });
  }

  if (task.completed_at) {
    events.push({
      id: 'completed',
      timestamp: task.completed_at,
      icon: <CheckCircle2 className="h-3 w-3" />,
      color: 'var(--celune-status-done)',
      label: 'Completed',
      agent: meta.completed_by ? (labels[meta.completed_by] ?? meta.completed_by) : undefined,
    });
  }

  return events;
}

/** Convert activity_log entries to timeline events */
function activityToEvents(activities: ActivityEntry[]): TimelineEvent[] {
  const labels = TASK_ASSIGNEE_LABELS as Record<string, string>;
  return activities.map((a) => ({
    id: `activity-${a.id}`,
    timestamp: a.created_at,
    icon: eventIcon(a.event_type, a.severity),
    color:
      a.severity === 'error'
        ? 'var(--celune-danger)'
        : a.severity === 'warning'
          ? 'var(--celune-status-review)'
          : 'var(--foreground-lighter)',
    label: a.title,
    agent: a.agent_id ? (labels[a.agent_id] ?? a.agent_id) : undefined,
  }));
}

function eventIcon(eventType: string, severity: string) {
  if (severity === 'error') return <AlertCircle className="h-3 w-3" />;
  if (eventType.includes('status')) return <ArrowRight className="h-3 w-3" />;
  if (eventType.includes('comment')) return <MessageSquare className="h-3 w-3" />;
  return <Activity className="h-3 w-3" />;
}

/** Format duration between two ISO timestamps */
function durationBetween(a: string, b: string): string | null {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function TaskDrawerTimeline({ task }: TaskDrawerTimelineProps) {
  const { transport } = useCelune();
  const [open, setOpen] = useState(false);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);

  const fetchActivity = useCallback(async () => {
    try {
      setActivities(await transport.activity.list({ taskId: task.id, limit: 100 }));
    } catch {
      /* ignore */
    }
  }, [task.id, transport]);

  // Fetch activity when section is opened
  useEffect(() => {
    if (open) fetchActivity();
  }, [open, fetchActivity]);

  const events = useMemo(() => {
    const lifecycle = deriveLifecycleEvents(task);
    const activityEvents = activityToEvents(activities);

    // Deduplicate: skip activity events that overlap with lifecycle events
    const lifecycleLabels = new Set(lifecycle.map((e) => e.label.toLowerCase()));
    const filtered = activityEvents.filter((a) => !lifecycleLabels.has(a.label.toLowerCase()));

    const merged = [...lifecycle, ...filtered];
    merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return merged;
  }, [task, activities]);

  // Don't render if there's only the "created" event
  if (events.length <= 1 && !open) {
    return null;
  }

  return (
    <div className="mt-6 border-t border-(--celune-border) px-5 pt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-1.5 py-2 text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase transition-opacity hover:opacity-80"
        style={{ color: LABEL_COLOR }}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Timeline
        <span className="ml-1 font-(weight:--celune-font-weight-regular) normal-case tabular-nums">
          ({events.length})
        </span>
      </button>

      {open && (
        <div className="relative mt-4 ml-2 pb-2">
          {events.map((event, i) => {
            const isLast = i === events.length - 1;
            const nextEvent = events[i + 1];
            const duration = nextEvent
              ? durationBetween(event.timestamp, nextEvent.timestamp)
              : null;

            return (
              <div key={event.id} className="relative flex gap-3">
                {/* Vertical line */}
                {!isLast && (
                  <div
                    className="absolute top-5 bottom-0 left-[9px] w-px"
                    style={{ backgroundColor: 'var(--border-default)' }}
                  />
                )}

                {/* Dot */}
                <div
                  className="mt-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: event.color, color: 'var(--celune-fg)' }}
                >
                  {event.icon}
                </div>

                {/* Content */}
                <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-4'}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-(weight:--celune-font-weight-medium) text-(--celune-fg)">
                      {event.label}
                    </span>
                    {event.agent && (
                      <span className="text-xs" style={{ color: LABEL_COLOR }}>
                        by {event.agent}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-(length:--celune-text-2xs) tabular-nums"
                      style={{ color: LABEL_COLOR }}
                    >
                      {formatRelativeTime(event.timestamp)}
                    </span>
                    {duration && (
                      <span
                        className="text-(length:--celune-text-3xs) tabular-nums"
                        style={{ color: LABEL_COLOR }}
                      >
                        +{duration}
                      </span>
                    )}
                  </div>
                  {event.detail && (
                    <p className="mt-0.5 text-xs text-(--celune-fg)/70">{event.detail}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
