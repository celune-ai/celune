'use client';

import { useEffect, useState } from 'react';
import { useTask, useUpdateTask } from '@celuneai/react/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const STATUSES = ['inbox', 'planning', 'in_progress', 'review', 'done'] as const;

const statusColor = (status: string) =>
  `var(--celune-status-${status.replace('_', '-')}, var(--muted-foreground))`;

export interface CeluneTaskDrawerProps {
  taskId: string | null;
  onClose: () => void;
  className?: string;
}

export function CeluneTaskDrawer({ taskId, onClose, className }: CeluneTaskDrawerProps) {
  const { data: task, isLoading } = useTask(taskId);
  const updateTask = useUpdateTask();
  const [title, setTitle] = useState('');

  useEffect(() => {
    setTitle(task?.title ?? '');
  }, [task?.title]);

  useEffect(() => {
    if (!taskId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [taskId, onClose]);

  if (!taskId) return null;

  const save = () => {
    const trimmed = title.trim();
    if (task && trimmed && trimmed !== task.title) {
      updateTask.mutate({ id: task.id, patch: { title: trimmed } });
    }
  };

  return (
    <aside
      role="dialog"
      aria-label={task ? `Task: ${task.title}` : 'Task'}
      className={cn(
        'bg-background text-foreground fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col gap-4 border-l p-6 shadow-lg',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground text-sm font-medium">Task</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      {isLoading || !task ? (
        <div className="bg-muted h-24 animate-pulse rounded-md" />
      ) : (
        <>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
            aria-label="Task title"
          />

          <div className="flex flex-wrap gap-2">
            {STATUSES.map((status) => (
              <Button
                key={status}
                size="sm"
                variant={task.status === status ? 'default' : 'outline'}
                onClick={() => updateTask.mutate({ id: task.id, patch: { status } })}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: statusColor(status) }}
                />
                {status.replace('_', ' ')}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Priority</span>
            <Badge variant="outline" className="capitalize">
              {task.priority}
            </Badge>
          </div>

          {task.description ? (
            <p className="text-muted-foreground text-sm whitespace-pre-wrap">{task.description}</p>
          ) : (
            <p className="text-muted-foreground text-sm">No description</p>
          )}
        </>
      )}
    </aside>
  );
}
