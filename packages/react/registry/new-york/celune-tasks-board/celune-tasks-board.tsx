'use client';

import { useState, type FormEvent } from 'react';
import { useCreateTask, useTasksQuery, useUpdateTask } from '@celuneai/react/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Task = NonNullable<ReturnType<typeof useTasksQuery>['data']>[number];

const COLUMNS = [
  { status: 'inbox', label: 'Inbox' },
  { status: 'planning', label: 'Planned' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
] as const;

/** Status color from the --celune-* contract when the host maps it, else the host's muted text. */
const statusColor = (status: string) =>
  `var(--celune-status-${status.replace('_', '-')}, var(--muted-foreground))`;

export interface CeluneTasksBoardProps {
  projectId?: string;
  onOpenTask?: (task: Task) => void;
  className?: string;
}

export function CeluneTasksBoard({ projectId, onOpenTask, className }: CeluneTasksBoardProps) {
  const { data: tasks = [], isLoading } = useTasksQuery({ projectId });
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const [title, setTitle] = useState('');

  const addTask = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    createTask.mutate({ title: trimmed, status: 'inbox', project_id: projectId });
    setTitle('');
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <form onSubmit={addTask} className="flex max-w-md gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task"
          aria-label="New task title"
        />
        <Button type="submit" disabled={!title.trim() || createTask.isPending}>
          Add
        </Button>
      </form>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((column) => {
          const items = tasks.filter((t) => t.status === column.status);
          return (
            <section
              key={column.status}
              className="bg-muted/50 flex w-72 shrink-0 flex-col gap-2 rounded-lg border p-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('text/plain');
                if (id) updateTask.mutate({ id, patch: { status: column.status } });
              }}
            >
              <header className="flex items-center gap-2 px-1 py-1">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: statusColor(column.status) }}
                />
                <h3 className="text-sm font-medium">{column.label}</h3>
                <Badge variant="secondary" className="ml-auto">
                  {items.length}
                </Badge>
              </header>

              {isLoading &&
                [0, 1].map((i) => (
                  <div key={i} className="bg-muted h-16 animate-pulse rounded-md" />
                ))}

              {!isLoading && items.length === 0 && (
                <p className="text-muted-foreground px-1 py-3 text-xs">No tasks</p>
              )}

              {items.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
                  onClick={() => onOpenTask?.(task)}
                  className="bg-card text-card-foreground hover:border-ring rounded-md border p-3 text-left text-sm shadow-xs transition-colors"
                >
                  <span className="line-clamp-2">{task.title}</span>
                  {task.priority === 'urgent' || task.priority === 'high' ? (
                    <Badge variant="destructive" className="mt-2 capitalize">
                      {task.priority}
                    </Badge>
                  ) : null}
                </button>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
