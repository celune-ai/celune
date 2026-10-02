'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  CheckCircle2,
  GitBranch,
  MessageSquare,
  AlertTriangle,
  Flag,
  ArrowRightLeft,
  Filter,
  Loader2,
} from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import type { ActivityFeedEntry, ActivityFeedResponse, FeedActionType } from '@repo/types';
import { fetchJson } from '@/lib/fetch-json';
import { formatRelativeTime } from '@/lib/date-utils';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { ReasoningBlock } from './reasoning-block';
import { AgentAvatar } from './agent-avatar';

// ── Action type styling ──────────────────────────────────────────────────────

const ACTION_CONFIG: Record<
  FeedActionType,
  { icon: typeof Activity; label: string; className: string }
> = {
  claimed: {
    icon: Flag,
    label: 'Claimed',
    className: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    className: 'bg-brand/10 text-brand border-brand/20',
  },
  delegated: {
    icon: ArrowRightLeft,
    label: 'Delegated',
    className: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
  },
  reviewed: {
    icon: MessageSquare,
    label: 'Reviewed',
    className: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  },
  milestone: {
    icon: GitBranch,
    label: 'Milestone',
    className: 'bg-brand/10 text-brand border-brand/20',
  },
  error: {
    icon: AlertTriangle,
    label: 'Error',
    className: 'bg-destructive/10 text-destructive border-destructive/20',
  },
  message: {
    icon: MessageSquare,
    label: 'Message',
    className: 'bg-foreground-lighter/10 text-foreground-lighter border-border',
  },
};

// ── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({
  agentFilter,
  actionFilter,
  agents,
  onAgentChange,
  onActionChange,
}: {
  agentFilter: string;
  actionFilter: string;
  agents: { agent_id: string; display_name: string }[];
  onAgentChange: (v: string) => void;
  onActionChange: (v: string) => void;
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Filter className="text-foreground-lighter h-3.5 w-3.5" />
      <select
        value={agentFilter}
        onChange={(e) => onAgentChange(e.target.value)}
        aria-label="Filter by agent"
        className="bg-surface-100 border-border text-foreground rounded-md border px-2 py-1 text-xs"
      >
        <option value="">All agents</option>
        {agents.map((a) => (
          <option key={a.agent_id} value={a.agent_id}>
            {a.display_name || a.agent_id.toUpperCase()}
          </option>
        ))}
      </select>
      <select
        value={actionFilter}
        onChange={(e) => onActionChange(e.target.value)}
        aria-label="Filter by action type"
        className="bg-surface-100 border-border text-foreground rounded-md border px-2 py-1 text-xs"
      >
        <option value="">All actions</option>
        <option value="claimed">Claimed</option>
        <option value="completed">Completed</option>
        <option value="delegated">Delegated</option>
        <option value="reviewed">Reviewed</option>
        <option value="milestone">Milestone</option>
        <option value="error">Error</option>
      </select>
    </div>
  );
}

// ── Single feed entry ────────────────────────────────────────────────────────

function FeedRow({ entry }: { entry: ActivityFeedEntry }) {
  const { workspaceHref } = useWorkspaceHref();
  const config = ACTION_CONFIG[entry.action_type];
  const Icon = config.icon;

  return (
    <tr className="border-border hover:bg-surface-75 border-b transition-colors">
      <td className="py-2 pr-3 pl-2">
        <AgentAvatar agentId={entry.agent_id} name={entry.agent_name} size="sm" />
      </td>
      <td className="text-foreground py-2 pr-3 text-sm font-medium whitespace-nowrap">
        {entry.agent_name}
      </td>
      <td className="py-2 pr-3">
        <Badge variant="outline" className={`text-[10px] leading-none ${config.className}`}>
          <Icon className="mr-0.5 h-2.5 w-2.5" />
          {config.label}
        </Badge>
      </td>
      <td className="text-foreground-light max-w-xs truncate py-2 pr-3 text-sm">
        {entry.task_id ? (
          <Link
            href={workspaceHref(`/tasks?id=${entry.task_id}`)}
            className="text-foreground hover:text-brand transition-colors"
          >
            {entry.title}
          </Link>
        ) : (
          entry.title
        )}
        {entry.summary && (
          <span className="text-foreground-lighter ml-1.5 text-xs">— {entry.summary}</span>
        )}
      </td>
      <td className="text-foreground-lighter py-2 text-right text-xs whitespace-nowrap">
        {formatRelativeTime(entry.created_at)}
      </td>
    </tr>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function ActivityFeed() {
  const { activeWorkspace } = useWorkspace();
  const [entries, setEntries] = useState<ActivityFeedEntry[]>([]);
  const [agents, setAgents] = useState<{ agent_id: string; display_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const observerRef = useRef<HTMLDivElement>(null);

  // Fetch workspace agents for filter dropdown
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    fetchJson<{ agent_id: string; display_name: string }[]>(
      `/api/agents/configs?workspace_id=${activeWorkspace.id}`,
    )
      .then((data) => {
        if (Array.isArray(data)) {
          setAgents(data.filter((a) => a.agent_id && a.display_name));
        }
      })
      .catch(() => {
        /* Non-critical */
      });
  }, [activeWorkspace?.id]);

  const fetchEntries = useCallback(
    async (cursor?: string) => {
      if (!activeWorkspace?.id) return;
      const isLoadMore = !!cursor;
      if (isLoadMore) setLoadingMore(true);
      else setLoading(true);

      try {
        const params = new URLSearchParams({
          workspace_id: activeWorkspace.id,
          limit: '30',
        });
        if (agentFilter) params.set('agent', agentFilter);
        if (actionFilter) params.set('type', actionFilter);
        if (cursor) params.set('cursor', cursor);

        const result = await fetchJson<ActivityFeedResponse>(
          `/api/agents/activity?${params.toString()}`,
        );
        if (isLoadMore) {
          setEntries((prev) => [...prev, ...result.entries]);
        } else {
          setEntries(result.entries);
        }
        setNextCursor(result.nextCursor);
      } catch {
        // Non-critical — feed is supplementary
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [activeWorkspace?.id, agentFilter, actionFilter],
  );

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Infinite scroll
  useEffect(() => {
    if (!observerRef.current || !nextCursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !loadingMore) {
          fetchEntries(nextCursor);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, fetchEntries]);

  // Note: no auto-refresh interval — it would reset paginated scroll state.
  // Data refreshes on tab switch or filter change.

  if (loading) {
    return (
      <div className="space-y-4">
        <FilterBar
          agentFilter={agentFilter}
          actionFilter={actionFilter}
          agents={agents}
          onAgentChange={setAgentFilter}
          onActionChange={setActionFilter}
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-foreground-lighter h-5 w-5 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <FilterBar
        agentFilter={agentFilter}
        actionFilter={actionFilter}
        agents={agents}
        onAgentChange={(v) => {
          setAgentFilter(v);
          setNextCursor(null);
        }}
        onActionChange={(v) => {
          setActionFilter(v);
          setNextCursor(null);
        }}
      />

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Activity className="text-foreground-lighter mb-3 h-8 w-8" />
          <p className="text-foreground-lighter text-sm">No activity yet</p>
          <p className="text-foreground-lighter/60 mt-1 text-xs">
            Agent activity will appear here as your team works on tasks.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-border border-b">
                <th className="py-2 pr-3 pl-2" />
                <th className="text-foreground-lighter py-2 pr-3 text-xs font-medium">Agent</th>
                <th className="text-foreground-lighter py-2 pr-3 text-xs font-medium">Action</th>
                <th className="text-foreground-lighter py-2 pr-3 text-xs font-medium">Details</th>
                <th className="text-foreground-lighter py-2 text-right text-xs font-medium">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <FeedRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>

          {/* Infinite scroll sentinel */}
          {nextCursor && (
            <div ref={observerRef} className="flex justify-center py-4">
              {loadingMore && <Loader2 className="text-foreground-lighter h-4 w-4 animate-spin" />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
