'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { Badge } from '@repo/ui/components/badge';
import type { BadgeProps } from '@repo/ui/components/badge';
import type { Task } from '@repo/types';
import { apiUrl } from '@repo/db/api';
import { priorityVariants, priorityWeight } from '@celuneai/react/utils';
import { useWorkspace } from '@/providers/workspace-provider';

function selectFocusTasks(tasks: Task[]): Task[] {
  const today = new Date().toISOString().slice(0, 10);

  // Exclude done and archived tasks
  const active = tasks.filter((t) => t.status !== 'done' && !t.archived_at);

  // Sort by priority weight, then by due_date proximity (sooner = higher)
  const sorted = [...active].sort((a, b) => {
    const pa = priorityWeight[a.priority] ?? 2;
    const pb = priorityWeight[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;

    // Both have due dates: closer date first
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    // Due date beats no due date
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;

    return 0;
  });

  return sorted.slice(0, 3);
}

export function TodayFocus() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const { activeWorkspace } = useWorkspace();

  useEffect(() => {
    if (!activeWorkspace) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(apiUrl(`/api/tasks?workspace_id=${activeWorkspace!.id}`));
        if (!res.ok) throw new Error('Failed to fetch tasks');
        const all: Task[] = await res.json();
        if (!cancelled) {
          setTasks(selectFocusTasks(all));
        }
      } catch (err) {
        console.error('Failed to load focus tasks:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Today&apos;s Focus</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="bg-muted h-5 w-14 animate-pulse rounded" />
                <div className="bg-muted h-4 flex-1 animate-pulse rounded" />
              </div>
            ))}
          </div>
        ) : tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="border-border flex items-center gap-2 rounded-md border p-2"
              >
                <Badge
                  variant={priorityVariants[task.priority] as BadgeProps['variant']}
                  className="shrink-0 text-xs"
                >
                  {task.priority}
                </Badge>
                <span className="flex-1 truncate text-sm font-medium">{task.title}</span>
                {task.assignee !== 'unassigned' && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {task.assignee}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground py-4 text-center text-sm">No focus tasks</p>
        )}
      </CardContent>
    </Card>
  );
}
