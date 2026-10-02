'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@repo/ui/components/dialog';
import { Input } from '@repo/ui/components/input';
import { Textarea } from '@repo/ui/components/textarea';
import { Button } from '@repo/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_ASSIGNEES,
  TASK_ASSIGNEE_LABELS,
} from '@repo/types';
import type { Task, TaskStatus, TaskPriority, TaskAssignee } from '@repo/types';
import type { TaskInput } from '../transport/types';
import { useCelune } from '../provider/context';

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  onSaved?: (task: Task) => void;
  projectId?: string;
}

export function TaskDialog({ open, onOpenChange, task, onSaved, projectId }: TaskDialogProps) {
  const isEdit = !!task;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('inbox');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assignee, setAssignee] = useState<TaskAssignee>('unassigned');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const { transport } = useCelune();

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
      setStatus(task.status);
      setPriority(task.priority);
      setAssignee(task.assignee);
      setDueDate(task.due_date ?? '');
    } else {
      setTitle('');
      setDescription('');
      setStatus('inbox');
      setPriority('normal');
      setAssignee('unassigned');
      setDueDate('');
    }
  }, [task, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);

    const payload: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      assignee,
      due_date: dueDate || null,
    };

    if (projectId) {
      payload.project_id = projectId;
    }

    try {
      const saved = isEdit
        ? await transport.tasks.update(task.id, payload)
        : await transport.tasks.create(payload as TaskInput);
      onSaved?.(saved);
    } catch (err) {
      console.error('Failed to save task:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="celune-dialog sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Task' : 'New Task'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the task details below.'
              : 'Fill in the details to create a new task.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="task-title"
              className="text-sm font-(weight:--celune-font-weight-medium)"
            >
              Title
            </label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              required
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="task-description"
              className="text-sm font-(weight:--celune-font-weight-medium)"
            >
              Description
            </label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is the task? How does it help? Approach, sequence, and any blockers..."
              rows={5}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-(weight:--celune-font-weight-medium)">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-(--celune-border) bg-(--celune-surface-raised)">
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {TASK_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-(weight:--celune-font-weight-medium)">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-(--celune-border) bg-(--celune-surface-raised)">
                  {TASK_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-(weight:--celune-font-weight-medium)">Assignee</label>
              <Select value={assignee} onValueChange={(v) => setAssignee(v as TaskAssignee)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-(--celune-border) bg-(--celune-surface-raised)">
                  {TASK_ASSIGNEES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {TASK_ASSIGNEE_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="task-due-date"
                className="text-sm font-(weight:--celune-font-weight-medium)"
              >
                Due Date
              </label>
              <Input
                id="task-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !title.trim()}>
              {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
