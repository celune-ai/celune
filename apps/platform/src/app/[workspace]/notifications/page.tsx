'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCircle2, ChevronLeft, ChevronRight, Loader2, XCircle } from 'lucide-react';
import { PageActionBar } from '@/components/page-action-bar';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { formatRelativeTime } from '@/lib/date-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationLogEntry {
  id: string;
  event_type: 'notification.sent' | 'notification.failed';
  title: string;
  details: {
    notification_event_type?: string;
    channel?: string;
    actor_agent?: string;
    preference_id?: string;
    error?: string;
  } | null;
  created_at: string;
}

interface HistoryResponse {
  history: NotificationLogEntry[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const CHANNEL_OPTIONS = [
  { value: 'all', label: 'All Channels' },
  { value: 'slack', label: 'Slack' },
  { value: 'email', label: 'Email' },
];

const EVENT_TYPE_OPTIONS = [
  { value: 'all', label: 'All Events' },
  { value: 'task.completed', label: 'Task Completed' },
  { value: 'task.blocked', label: 'Task Blocked' },
  { value: 'review.requested', label: 'Review Requested' },
  { value: 'review.completed', label: 'Review Completed' },
  { value: 'agent.status_changed', label: 'Agent Status' },
  { value: 'deploy.triggered', label: 'Deploy Triggered' },
];

const AGENT_NAMES: Record<string, string> = {
  rick: 'RICK',
  sage: 'SAGE',
  noir: 'NOIR',
  scan: 'SCAN',
  delv: 'DELV',
  trek: 'TREK',
  echo: 'ECHO',
  bond: 'BOND',
  vita: 'VITA',
};

const CHANNEL_LABELS: Record<string, string> = {
  slack: 'Slack',
  email: 'Email',
  discord: 'Discord',
  teams: 'Teams',
};

const EVENT_LABELS: Record<string, string> = {
  'task.completed': 'Task Completed',
  'task.assigned': 'Task Assigned',
  'task.blocked': 'Task Blocked',
  'review.requested': 'Review Requested',
  'review.completed': 'Review Complete',
  'agent.status_changed': 'Agent Status',
  'deploy.triggered': 'Deploy Triggered',
  'deploy.completed': 'Deploy Complete',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NotificationHistoryPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<NotificationLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);

  // Filters
  const [channelFilter, setChannelFilter] = useState('all');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');

  const fetchHistory = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        workspace_id: workspaceId,
        page: String(page),
        per_page: String(PAGE_SIZE),
      });
      if (channelFilter !== 'all') params.set('channel', channelFilter);
      if (eventTypeFilter !== 'all') params.set('event_type', eventTypeFilter);

      const res = await fetchJson<HistoryResponse>(
        apiUrl(`/api/notifications/history?${params.toString()}`),
      );

      if ('error' in res) return;

      setEntries(res.history ?? []);
      setTotal(res.total ?? 0);
      setPages(res.pages ?? 1);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, page, channelFilter, eventTypeFilter]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [channelFilter, eventTypeFilter]);

  return (
    <div className="flex min-h-full flex-col">
      <PageActionBar>
        <div className="flex items-center gap-2">
          <Bell className="text-foreground-lighter h-4 w-4" />
          <span className="text-foreground text-xl font-medium">Notification History</span>
        </div>
      </PageActionBar>

      {/* Filters */}
      <div className="border-border border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-foreground-lighter ml-auto text-xs">
            {total > 0 ? `${total} notification${total === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="text-foreground-lighter h-6 w-6 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bell className="text-foreground-lighter mb-3 h-8 w-8 opacity-40" />
            <p className="text-foreground-lighter text-sm">No notification history yet</p>
            <p className="text-foreground-lighter mt-1 text-xs">
              Notifications will appear here once your agents start sending them.
            </p>
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th className="text-foreground-lighter px-4 py-2.5 text-left text-xs font-medium">
                    Status
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-left text-xs font-medium">
                    Event
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-left text-xs font-medium">
                    Channel
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-left text-xs font-medium">
                    Agent
                  </th>
                  <th className="text-foreground-lighter px-4 py-2.5 text-left text-xs font-medium">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  const success = entry.event_type === 'notification.sent';
                  const channel = entry.details?.channel ?? '—';
                  const eventType = entry.details?.notification_event_type ?? '—';
                  const actor = entry.details?.actor_agent;
                  const errMsg = entry.details?.error;

                  return (
                    <tr
                      key={entry.id}
                      className={`border-border group ${i < entries.length - 1 ? 'border-b' : ''}`}
                    >
                      <td className="px-4 py-3">
                        {success ? (
                          <div className="flex items-center gap-1.5 text-green-500">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span className="text-xs">Sent</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-red-500">
                            <XCircle className="h-3.5 w-3.5" />
                            <span className="text-xs">Failed</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-foreground text-xs">
                          {EVENT_LABELS[eventType] ?? eventType}
                        </p>
                        {!success && errMsg && (
                          <p className="text-destructive mt-0.5 text-xs opacity-70">{errMsg}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-xs">
                          {CHANNEL_LABELS[channel] ?? channel}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-foreground-lighter text-xs">
                          {actor ? (AGENT_NAMES[actor] ?? actor.toUpperCase()) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-foreground-lighter text-xs">
                          {formatRelativeTime(entry.created_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && pages > 1 && (
        <div className="border-border border-t px-6 py-3">
          <div className="flex items-center justify-between">
            <span className="text-foreground-lighter text-xs">
              Page {page} of {pages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="gap-1"
              >
                <ChevronLeft className="h-3 w-3" />
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="gap-1"
              >
                Next
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
