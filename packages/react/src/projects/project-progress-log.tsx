'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Bot, CheckCircle2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Badge } from '../components/badge';
import { useCelune } from '../provider/context';

interface ProgressEntry {
  id: string;
  timestamp: string;
  agent: string;
  task_title: string;
  task_id: string;
  outcome: string;
  sprint: number | null;
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function ProgressEntryRow({ entry }: { entry: ProgressEntry }) {
  const [expanded, setExpanded] = useState(false);
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <div className="border-b border-(--celune-border) px-1 py-3 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 text-left"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-(--celune-status-done)" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-(weight:--celune-font-weight-medium) text-(--celune-fg)">
              {entry.task_title}
            </span>
            {entry.sprint != null && (
              <Badge variant="muted" className="text-(length:--celune-text-3xs)">
                S{entry.sprint}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-(--celune-fg-muted)">
            <span className="flex items-center gap-1">
              <Bot className="h-3 w-3" />
              {entry.agent}
            </span>
            <span className="text-(--celune-fg-muted)">·</span>
            <span>{timeAgo(entry.timestamp)}</span>
          </div>
        </div>
        <ChevronIcon className="mt-0.5 h-4 w-4 shrink-0 text-(--celune-fg-muted)" />
      </button>

      {expanded && (
        <div className="mt-2 ml-7 rounded-md bg-(--celune-bg) p-3 text-xs whitespace-pre-wrap text-(--celune-fg-muted)">
          {entry.outcome}
        </div>
      )}
    </div>
  );
}

export function ProjectProgressLog({ projectId }: { projectId: string }) {
  const { transport } = useCelune();
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProgress = useCallback(async () => {
    setLoading(true);
    try {
      if (transport.projects.progressLog) {
        setEntries((await transport.projects.progressLog(projectId)) as unknown as ProgressEntry[]);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [projectId, transport]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-(--celune-fg-muted)" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-(--celune-fg-muted)">
        No completed tasks yet. Progress entries appear as tasks are completed with outcomes.
      </div>
    );
  }

  // Group by sprint
  const bySprint = new Map<number | null, ProgressEntry[]>();
  for (const entry of entries) {
    const key = entry.sprint;
    const list = bySprint.get(key) ?? [];
    list.push(entry);
    bySprint.set(key, list);
  }

  const sortedSprints = [...bySprint.keys()].sort((a, b) => (a ?? 99) - (b ?? 99));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-(--celune-fg-muted)" />
        <h3 className="text-sm font-(weight:--celune-font-weight-medium) text-(--celune-fg)">
          Progress Log
        </h3>
        <Badge variant="muted" className="text-(length:--celune-text-3xs)">
          {entries.length} completed
        </Badge>
      </div>

      <div className="rounded-lg border border-(--celune-border)">
        {sortedSprints.map((sprint) => {
          const sprintEntries = bySprint.get(sprint) ?? [];
          return (
            <div key={sprint ?? 'none'}>
              {sortedSprints.length > 1 && (
                <div className="border-b border-(--celune-border) bg-(--celune-bg) px-3 py-1.5">
                  <span className="text-xs font-(weight:--celune-font-weight-medium) text-(--celune-fg-muted)">
                    {sprint != null ? `Sprint ${sprint}` : 'Unassigned'}
                  </span>
                </div>
              )}
              {sprintEntries.map((entry) => (
                <ProgressEntryRow key={entry.id} entry={entry} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
