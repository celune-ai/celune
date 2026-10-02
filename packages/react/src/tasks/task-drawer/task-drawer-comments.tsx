'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Activity } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@repo/ui/components/tabs';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { AGENT_COLORS } from '../../lib/agent-colors';
import { formatRelativeTime } from '../../lib/date-utils';
import { useCelune } from '../../provider/context';
import type { TaskComment, FeedItem } from './types';
import type { ActivityEntry } from '@repo/types';

interface TaskDrawerCommentsProps {
  taskId: string;
  /** Append a comment from outside (e.g. footer input) */
  externalComment?: TaskComment | null;
}

export function TaskDrawerComments({ taskId, externalComment }: TaskDrawerCommentsProps) {
  const { transport } = useCelune();
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [sortNewest, setSortNewest] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);

  // Accept externally-submitted comments (from footer input)
  const lastExternalId = useRef<string | null>(null);
  useEffect(() => {
    if (externalComment && externalComment.id !== lastExternalId.current) {
      lastExternalId.current = externalComment.id;
      setComments((prev) => [...prev, externalComment]);
    }
  }, [externalComment]);

  const labels = TASK_ASSIGNEE_LABELS as Record<string, string>;

  const fetchComments = useCallback(async () => {
    try {
      setComments(await transport.comments.list(taskId));
    } catch {
      /* ignore */
    }
  }, [taskId, transport]);

  const fetchActivity = useCallback(async () => {
    try {
      setActivities(await transport.activity.list({ taskId, limit: 50 }));
    } catch {
      /* ignore */
    }
  }, [taskId, transport]);

  useEffect(() => {
    fetchComments();
    fetchActivity();
  }, [fetchComments, fetchActivity]);

  const feedItems: FeedItem[] = useMemo(() => {
    if (tab === 'comments') {
      return comments.map((c) => ({ kind: 'comment' as const, data: c }));
    }
    const items: FeedItem[] = [
      ...comments.map((c) => ({ kind: 'comment' as const, data: c })),
      ...activities.map((a) => ({ kind: 'activity' as const, data: a })),
    ];
    items.sort((a, b) => {
      const aTime = new Date(a.data.created_at).getTime();
      const bTime = new Date(b.data.created_at).getTime();
      return aTime - bTime;
    });
    return items;
  }, [tab, comments, activities]);

  const sortedItems = useMemo(() => {
    if (sortNewest) return [...feedItems].reverse();
    return feedItems;
  }, [feedItems, sortNewest]);

  const hasComments = comments.length > 0;

  return (
    <div className="px-5 pt-4 pb-4">
      {/* Section content — no top divider, flows from Timeline above */}

      {/* Only show tabs + sort once there are comments */}
      {hasComments && (
        <div className="mb-3 flex items-center justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'comments' | 'activity')}>
            <TabsList className="h-7">
              <TabsTrigger value="comments" className="px-2 py-0.5 text-xs">
                Comments
              </TabsTrigger>
              <TabsTrigger value="activity" className="px-2 py-0.5 text-xs">
                All Activity
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <button
            type="button"
            onClick={() => setSortNewest(!sortNewest)}
            className="flex items-center gap-1 text-(length:--celune-text-2xs) text-(--celune-fg-muted) transition-colors hover:text-(--celune-fg)"
          >
            <ArrowDownUp className="h-3 w-3" />
            {sortNewest ? 'Newest' : 'Oldest'}
          </button>
        </div>
      )}

      {/* Feed */}
      {sortedItems.length > 0 && (
        <div className="mb-4 space-y-3">
          {sortedItems.map((item) => {
            if (item.kind === 'comment') {
              const c = item.data;
              const color = AGENT_COLORS[c.author];
              return (
                <div key={`comment-${c.id}`} className="flex gap-2.5">
                  <span
                    className="mt-1 h-5 w-5 shrink-0 rounded-full"
                    style={{ backgroundColor: color?.color ?? 'var(--celune-fg-muted)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-(weight:--celune-font-weight-medium)">
                        {labels[c.author] ?? c.author}
                      </span>
                      <span className="text-(length:--celune-text-2xs) text-(--celune-fg-muted)">
                        {formatRelativeTime(c.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm whitespace-pre-wrap">{c.content}</p>
                  </div>
                </div>
              );
            }

            const a = item.data;
            return (
              <div key={`activity-${a.id}`} className="flex items-start gap-2.5">
                <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--celune-surface-hover)">
                  <Activity className="h-3 w-3 text-(--celune-fg-muted)" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-(--celune-fg-muted)">{a.title}</span>
                    <span className="text-(length:--celune-text-2xs) text-(--celune-fg-muted)">
                      {formatRelativeTime(a.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
