'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  AlertOctagon,
  ExternalLink,
  X,
} from 'lucide-react';
import { PageActionBar } from '@/components/page-action-bar';
import { ActivityDrawer } from '@/components/activity-drawer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';
import { Button } from '@repo/ui/components/button';
import { Switch } from '@repo/ui/components/switch';
import { Badge } from '@repo/ui/components/badge';
import type { ActivityEntry, SeverityLevel } from '@repo/types';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { formatRelativeTime } from '@/lib/date-utils';
import { useWorkspace } from '@/providers/workspace-provider';

const PAGE_SIZE = 100;

const SEVERITY_STYLES: Record<string, string> = {
  warning: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  error: 'bg-red-500/15 text-red-400 border-red-500/20',
};

const SEVERITY_ICONS: Record<string, typeof AlertTriangle> = {
  warning: AlertTriangle,
  error: AlertOctagon,
};

const ROW_HIGHLIGHT: Record<string, string> = {
  warning: 'hover:bg-yellow-500/5',
  error: 'hover:bg-red-500/5',
};

// Sentry issue shape from our proxy API
interface SentryAlert {
  id: string;
  title: string;
  severity: string;
  event_type: string;
  source: 'sentry';
  created_at: string;
  first_seen: string;
  last_seen: string;
  count: number;
  culprit: string;
  permalink: string;
  short_id: string;
  status: string;
  metadata_type?: string;
  metadata_value?: string;
  metadata_filename?: string;
  metadata_function?: string;
  platform: string;
}

// Unified alert row — either an ActivityEntry or a Sentry issue
type AlertRow = { kind: 'internal'; data: ActivityEntry } | { kind: 'sentry'; data: SentryAlert };

function TruncatedText({ text }: { text: string }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = spanRef.current;
    if (el) setIsTruncated(el.scrollWidth > el.clientWidth);
  }, [text]);

  return (
    <span ref={spanRef} className="block truncate" title={isTruncated ? text : undefined}>
      {text}
    </span>
  );
}

function DetailPreview({ details }: { details: Record<string, unknown> | null }) {
  if (!details) return <span className="text-muted-foreground">—</span>;

  const SKIP = new Set(['id', 'task_id', 'backfill']);
  const entry = Object.entries(details).find(([k]) => !SKIP.has(k));
  if (!entry) return <span className="text-muted-foreground">—</span>;

  const [k, v] = entry;
  const display = typeof v === 'object' ? JSON.stringify(v) : String(v);
  const truncated = display.length > 40 ? display.slice(0, 40) + '…' : display;

  return (
    <span className="text-muted-foreground font-mono text-[11px]" title={`${k}: ${display}`}>
      {k}: {truncated}
    </span>
  );
}

function SentryDetail({ alert }: { alert: SentryAlert }) {
  return (
    <span className="text-muted-foreground flex items-center gap-2 font-mono text-[11px]">
      <span>{alert.count.toLocaleString()} events</span>
      {alert.permalink && (
        <a
          href={alert.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand hover:text-brand/80 inline-flex items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}

export default function AlertsPage() {
  const [internalEntries, setInternalEntries] = useState<ActivityEntry[]>([]);
  const [sentryAlerts, setSentryAlerts] = useState<SentryAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<ActivityEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sentryError, setSentryError] = useState<string | null>(null);
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const { activeWorkspace } = useWorkspace();

  // Fetch internal alerts from activity_log
  const fetchInternal = useCallback(() => {
    if (!activeWorkspace?.id) return Promise.resolve();
    const params = new URLSearchParams();
    if (severityFilter === 'all') {
      params.set('severity_in', 'warning,error');
    } else {
      params.set('severity', severityFilter);
    }
    if (!showAcknowledged) {
      params.set('acknowledged', 'false');
    }
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(page * PAGE_SIZE));
    params.set('workspace_id', activeWorkspace.id);

    return fetchJson<{ data: ActivityEntry[]; total: number }>(apiUrl(`/api/activity?${params}`))
      .then((result) => {
        setInternalEntries(result.data ?? []);
        setTotal(result.total ?? 0);
      })
      .catch(console.error);
  }, [severityFilter, showAcknowledged, page, activeWorkspace]);

  // Fetch Sentry issues
  const fetchSentry = useCallback(() => {
    return fetchJson<{ issues: SentryAlert[]; error?: string }>(apiUrl('/api/alerts/sentry'))
      .then((result) => {
        setSentryAlerts(result.issues ?? []);
        setSentryError(result.error ?? null);
      })
      .catch((err) => {
        console.error('Sentry fetch failed:', err);
        setSentryError(err.message);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchInternal(), fetchSentry()]).finally(() => setLoading(false));
  }, [fetchInternal, fetchSentry]);

  // Trigger health-to-alert bridging
  const triggerHealthCheck = useCallback(() => {
    fetch(apiUrl('/api/health/check-and-alert'), { method: 'POST' }).catch(console.error);
  }, []);

  // Fire health check on mount
  useEffect(() => {
    triggerHealthCheck();
  }, [triggerHealthCheck]);

  // Auto-refresh every 60s (including health check)
  useEffect(() => {
    const interval = setInterval(() => {
      triggerHealthCheck();
      fetchInternal();
      fetchSentry();
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchInternal, fetchSentry, triggerHealthCheck]);

  const handleFilterChange = useCallback((val: string) => {
    setSeverityFilter(val);
    setPage(0);
  }, []);

  const handleDismiss = async (id: string) => {
    await fetchJson(apiUrl('/api/activity'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });
    fetchInternal();
  };

  const handleDismissAll = async () => {
    const internalIds = rows.filter((r) => r.kind === 'internal').map((r) => r.data.id);
    if (internalIds.length === 0) return;
    await fetchJson(apiUrl('/api/activity'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: internalIds }),
    });
    fetchInternal();
  };

  // Build unified rows
  const rows: AlertRow[] = [];

  if (sourceFilter !== 'sentry') {
    for (const entry of internalEntries) {
      // When "health" filter is active, only show integration.* event_types
      if (sourceFilter === 'health' && !entry.event_type.startsWith('integration.')) continue;
      rows.push({ kind: 'internal', data: entry });
    }
  }

  if (sourceFilter !== 'internal' && sourceFilter !== 'health') {
    // Filter Sentry alerts by severity
    const filteredSentry = sentryAlerts.filter((a) => {
      if (severityFilter === 'all') return true;
      return a.severity === severityFilter;
    });
    for (const alert of filteredSentry) {
      rows.push({ kind: 'sentry', data: alert });
    }
  }

  // Sort by time descending
  rows.sort((a, b) => {
    const aTime = a.kind === 'internal' ? a.data.created_at : a.data.last_seen;
    const bTime = b.kind === 'internal' ? b.data.created_at : b.data.last_seen;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  const totalCount = sourceFilter === 'sentry' ? rows.length : total + sentryAlerts.length;

  const handleRowClick = (row: AlertRow) => {
    if (row.kind === 'internal') {
      setSelectedEntry(row.data);
      setDrawerOpen(true);
    } else {
      // For Sentry issues, open the Sentry permalink
      if (row.data.permalink) {
        window.open(row.data.permalink, '_blank', 'noopener,noreferrer');
      }
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageActionBar>
        <span className="text-foreground text-xl font-medium">System Alerts</span>
        <div className="flex items-center gap-3">
          {!loading && (
            <span className="text-muted-foreground text-sm tabular-nums">
              {rows.length.toLocaleString()} alert{rows.length !== 1 ? 's' : ''}
              {sentryError && (
                <span className="ml-2 text-yellow-500" title={sentryError}>
                  Sentry unavailable
                </span>
              )}
            </span>
          )}
          {!showAcknowledged && rows.some((r) => r.kind === 'internal') && (
            <Button variant="outline" size="md" onClick={handleDismissAll}>
              Dismiss all
            </Button>
          )}
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <Switch
              checked={showAcknowledged}
              onCheckedChange={(v) => {
                setShowAcknowledged(v);
                setPage(0);
              }}
            />
            Show dismissed
          </label>
          <Select
            value={sourceFilter}
            onValueChange={(v) => {
              setSourceFilter(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="internal">Internal</SelectItem>
              <SelectItem value="sentry">Sentry</SelectItem>
              <SelectItem value="health">Health</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={handleFilterChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All alerts</SelectItem>
              <SelectItem value="warning">Warnings only</SelectItem>
              <SelectItem value="error">Errors only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PageActionBar>

      <div className="space-y-4 p-6">
        {loading ? (
          <div className="border-border overflow-hidden rounded-lg border">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-200/50 border-border/30 h-11 animate-pulse border-b last:border-0"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="border-border rounded-lg border border-dashed p-16 text-center">
            <div className="bg-surface-200 mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full">
              <AlertTriangle className="text-foreground-lighter h-5 w-5" />
            </div>
            <p className="text-foreground text-sm font-medium">All clear</p>
            <p className="text-muted-foreground mt-1 text-xs">No warnings or errors found</p>
          </div>
        ) : (
          <div className="border-border overflow-hidden overflow-x-auto rounded-lg border">
            <table
              className="w-full min-w-[700px] table-fixed text-sm"
              aria-label="Alerts and warnings"
            >
              <colgroup>
                <col className="w-[100px]" />
                <col className="w-[28px]" />
                {/* Message: takes remaining space */}
                <col />
                <col className="w-[76px]" />
                <col className="w-[70px]" />
                <col className="w-[110px]" />
                <col className="w-[90px]" />
                <col className="w-[200px]" />
                <col className="w-[36px]" />
              </colgroup>
              <thead>
                <tr className="border-border bg-surface-100 border-b">
                  {[
                    'Time',
                    '',
                    'Alert',
                    'Severity',
                    'Instances',
                    'Type',
                    'Source',
                    'Detail',
                    '',
                  ].map((h, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="text-foreground-lighter px-4 py-3 text-left text-xs font-medium tracking-wider uppercase first:pl-4"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = row.kind === 'internal' ? row.data.id : row.data.id;
                  const title = row.kind === 'internal' ? row.data.title : row.data.title;
                  const sev = (
                    row.kind === 'internal' ? row.data.severity : row.data.severity
                  ) as SeverityLevel;
                  const time = row.kind === 'internal' ? row.data.created_at : row.data.last_seen;
                  const eventType =
                    row.kind === 'internal' ? row.data.event_type : row.data.event_type;
                  const source = row.kind === 'internal' ? (row.data.source ?? '—') : 'sentry';
                  const Icon = SEVERITY_ICONS[sev] ?? AlertTriangle;
                  const rowHover = ROW_HIGHLIGHT[sev] ?? 'hover:bg-surface-100/50';

                  const isAcknowledged =
                    row.kind === 'internal' && row.data.acknowledged_at !== null;

                  return (
                    <tr
                      key={id}
                      className={`group border-border cursor-pointer border-b transition-colors last:border-0 ${rowHover} ${isAcknowledged ? 'opacity-50' : ''}`}
                      onClick={() => handleRowClick(row)}
                    >
                      <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap tabular-nums">
                        {formatRelativeTime(time)}
                      </td>
                      <td className="py-3 pr-0 pl-4">
                        <Icon
                          className={`h-3.5 w-3.5 shrink-0 ${
                            sev === 'error' ? 'text-red-400' : 'text-yellow-400'
                          }`}
                        />
                      </td>
                      <td className="max-w-0 px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <TruncatedText text={title} />
                          {row.kind === 'sentry' && (
                            <ExternalLink className="text-muted-foreground h-3 w-3 shrink-0" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                            SEVERITY_STYLES[sev] ?? ''
                          }`}
                        >
                          {sev}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {(() => {
                          const count =
                            row.kind === 'sentry'
                              ? row.data.count
                              : typeof (row.data.details as Record<string, unknown> | null)
                                    ?.instance_count === 'number'
                                ? ((row.data.details as Record<string, unknown>)
                                    .instance_count as number)
                                : 1;
                          return count > 1 ? (
                            <Badge
                              variant="secondary"
                              className="px-1.5 py-0 text-[11px] tabular-nums"
                            >
                              x{count.toLocaleString()}
                            </Badge>
                          ) : null;
                        })()}
                      </td>
                      <td className="max-w-0 px-4 py-3">
                        <Badge
                          variant="secondary"
                          className="max-w-full truncate px-1.5 py-0 text-[11px] font-normal"
                        >
                          {eventType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {source === 'sentry' ? (
                          <Badge variant="warning" className="px-1.5 py-0 text-[11px]">
                            Sentry
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">{source}</span>
                        )}
                      </td>
                      <td className="max-w-0 px-4 py-3">
                        {row.kind === 'sentry' ? (
                          <SentryDetail alert={row.data} />
                        ) : (
                          <DetailPreview
                            details={row.data.details as Record<string, unknown> | null}
                          />
                        )}
                      </td>
                      <td className="px-2 py-3">
                        {row.kind === 'internal' && !isAcknowledged && (
                          <button
                            className="text-muted-foreground hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDismiss(row.data.id);
                            }}
                            title="Dismiss"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination — only for internal alerts when not filtering to sentry-only */}
        {sourceFilter !== 'sentry' && Math.ceil(total / PAGE_SIZE) > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{' '}
              {total.toLocaleString()} internal
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="md"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </Button>
              <span className="text-muted-foreground px-1 text-xs tabular-nums">
                {page + 1} / {Math.ceil(total / PAGE_SIZE)}
              </span>
              <Button
                variant="outline"
                size="md"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= Math.ceil(total / PAGE_SIZE) - 1}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <ActivityDrawer
        open={drawerOpen}
        entry={selectedEntry}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedEntry(null);
        }}
      />
    </div>
  );
}
