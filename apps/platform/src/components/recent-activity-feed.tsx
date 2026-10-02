'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  Info,
  ArrowRight,
  Bot,
  KanbanSquare,
  FolderKanban,
} from 'lucide-react';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';

interface ActivityEntry {
  id: string;
  event_type: string;
  severity: string;
  title: string;
  details: Record<string, unknown> | null;
  created_at: string;
  task_id: string | null;
  agent_id: string | null;
}

const SEVERITY_ICONS: Record<string, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
  error: AlertCircle,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'text-muted-foreground',
  success: 'text-brand',
  warning: 'text-warning',
  error: 'text-destructive',
};

function getEventIcon(eventType: string) {
  if (eventType.includes('task')) return KanbanSquare;
  if (eventType.includes('project')) return FolderKanban;
  if (eventType.includes('agent')) return Bot;
  return Activity;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RecentActivityFeed() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivity = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const result = await fetchJson<ActivityEntry[]>(
        apiUrl(
          `/api/activity?workspace_id=${activeWorkspace.id}&limit=10&severity_in=info,warning`,
        ),
      );
      setEntries(Array.isArray(result) ? result : []);
    } catch {
      // Silently fail — activity feed is non-critical
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  if (loading) {
    return (
      <div className="border-border bg-surface-75 rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="text-muted-foreground h-4 w-4" />
          <span className="text-foreground text-sm font-semibold">Recent Activity</span>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="bg-surface-200 h-4 w-4 animate-pulse rounded-full" />
              <div className="bg-surface-200 h-4 flex-1 animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="border-border bg-surface-75 rounded-lg border">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="text-muted-foreground h-4 w-4" />
          <span className="text-foreground text-sm font-semibold">Recent Activity</span>
        </div>
        <Link
          href={workspaceHref('/feed')}
          aria-label="View all activity"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {entries.length === 0 ? (
        <div className="px-4 pb-4">
          <p className="text-muted-foreground text-xs">
            No activity yet. Complete the setup checklist to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-0.5 px-2 pb-2">
          {entries.map((entry) => {
            const SeverityIcon = SEVERITY_ICONS[entry.severity] ?? Info;
            const colorClass = SEVERITY_COLORS[entry.severity] ?? 'text-muted-foreground';
            return (
              <div key={entry.id} className="flex items-start gap-2.5 rounded-md px-2 py-1.5">
                <SeverityIcon className={`mt-0.5 h-4 w-4 shrink-0 ${colorClass}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm">{entry.title}</p>
                  <p className="text-muted-foreground text-xs">{timeAgo(entry.created_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
