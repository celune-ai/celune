'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
import { Badge } from '@repo/ui/components/badge';
import type { ActivityEntry, SeverityLevel } from '@repo/types';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { formatRelativeTime } from '@/lib/date-utils';
import { AGENTS } from '@/lib/agents-data';
import { useWorkspace } from '@/providers/workspace-provider';

const PAGE_SIZE = 100;

const SEVERITY_STYLES: Record<SeverityLevel, string> = {
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  warning: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  error: 'bg-red-500/15 text-red-400 border-red-500/20',
};

// AI agents that can appear in audit trail
const AGENT_OPTIONS = AGENTS.filter((a) => a.type === 'ai').map((a) => ({
  id: a.id,
  label: a.name,
}));

function extractMetadata(details: Record<string, unknown> | null): {
  tokens: string | null;
  queryLen: string | null;
} {
  if (!details) return { tokens: null, queryLen: null };

  const TOKEN_KEYS = [
    'tokens',
    'token_count',
    'total_tokens',
    'prompt_tokens',
    'completion_tokens',
    'input_tokens',
    'output_tokens',
  ];
  const QUERY_LEN_KEYS = ['query_length', 'prompt_length'];
  const SKIP_KEYS = ['id', 'task_id', 'backfill'];

  let tokens: string | null = null;
  let queryLen: string | null = null;

  for (const [k, v] of Object.entries(details)) {
    if (SKIP_KEYS.includes(k)) continue;
    if (TOKEN_KEYS.includes(k) && (typeof v === 'number' || typeof v === 'string')) {
      tokens = String(v);
    } else if (QUERY_LEN_KEYS.includes(k) && typeof v === 'number') {
      queryLen = String(v);
    } else if (k === 'query' && typeof v === 'string') {
      queryLen = String(v.length);
    }
  }

  return { tokens, queryLen };
}

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

export default function FeedPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<ActivityEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { activeWorkspace } = useWorkspace();

  const totalPages = Math.ceil(total / PAGE_SIZE);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const params = new URLSearchParams();
    if (severityFilter !== 'all') params.set('severity', severityFilter);
    if (agentFilter !== 'all') params.set('agent_id', agentFilter);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(page * PAGE_SIZE));
    params.set('workspace_id', activeWorkspace.id);

    setLoading(true);
    fetchJson<{ data: ActivityEntry[]; total: number }>(apiUrl(`/api/activity?${params}`))
      .then((result) => {
        setEntries(result.data ?? []);
        setTotal(result.total ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [severityFilter, agentFilter, page, activeWorkspace]);

  const handleSeverityChange = useCallback((val: string) => {
    setSeverityFilter(val);
    setPage(0);
  }, []);

  const handleAgentChange = useCallback((val: string) => {
    setAgentFilter(val);
    setPage(0);
  }, []);

  const handleRowClick = (entry: ActivityEntry) => {
    setSelectedEntry(entry);
    setDrawerOpen(true);
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageActionBar>
        <span className="text-foreground text-xl font-medium">Activity Feed</span>
        <div className="flex items-center gap-2">
          <Select value={severityFilter} onValueChange={handleSeverityChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All Severity</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Select value={agentFilter} onValueChange={handleAgentChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Agent" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All Agents</SelectItem>
              {AGENT_OPTIONS.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.label}
                </SelectItem>
              ))}
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
        ) : entries.length === 0 ? (
          <div className="border-border rounded-lg border border-dashed p-12 text-center">
            <p className="text-muted-foreground text-sm">No activity yet</p>
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full table-fixed text-sm" aria-label="Activity feed">
              <colgroup>
                <col className="w-[100px]" />
                {/* Event: no width — takes all remaining space */}
                <col />
                <col className="w-[76px]" />
                <col className="w-[130px]" />
                <col className="w-[88px]" />
                <col className="w-[72px]" />
                <col className="w-[60px]" />
                <col className="w-[56px]" />
              </colgroup>
              <thead>
                <tr className="border-border bg-surface-100 border-b">
                  {['Time', 'Event', 'Severity', 'Type', 'Source', 'Agent', 'Tokens', 'Query'].map(
                    (h) => (
                      <th
                        key={h}
                        scope="col"
                        className="text-foreground-lighter px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const { tokens, queryLen } = extractMetadata(entry.details);
                  return (
                    <tr
                      key={entry.id}
                      className="border-border hover:bg-surface-100/50 cursor-pointer border-b transition-colors last:border-0"
                      onClick={() => handleRowClick(entry)}
                    >
                      <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap tabular-nums">
                        {formatRelativeTime(entry.created_at)}
                      </td>
                      <td className="max-w-0 px-4 py-3 text-sm">
                        <TruncatedText text={entry.title} />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[entry.severity]}`}
                        >
                          {entry.severity}
                        </span>
                      </td>
                      <td className="max-w-0 px-4 py-3">
                        <Badge
                          variant="secondary"
                          className="max-w-full truncate px-1.5 py-0 text-[11px] font-normal"
                        >
                          {entry.event_type}
                        </Badge>
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-xs">
                        {entry.source ?? '\u2014'}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-xs">
                        {entry.agent_id ?? '\u2014'}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-right text-xs tabular-nums">
                        {tokens ?? '\u2014'}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-right text-xs tabular-nums">
                        {queryLen ?? '\u2014'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{' '}
              {total.toLocaleString()}
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
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="md"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1}
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
