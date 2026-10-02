'use client';

import { useState, useCallback, useEffect, useId } from 'react';
import { Trash2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui/components/dialog';
import { Input } from '@repo/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import type {
  VoiceParsedTask,
  VoiceParsedUpdate,
  VoiceParseResult,
} from '@/app/api/voice/parse/route';

interface VoiceTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parseResult: VoiceParseResult | null;
  projects?: { id: string; name: string }[];
  onComplete?: () => void;
}

const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-amber-400',
  normal: 'text-foreground-light',
  low: 'text-foreground-lighter',
};

interface TaskWithKey extends VoiceParsedTask {
  _key: string;
}

let keyCounter = 0;
function withKeys(tasks: VoiceParsedTask[]): TaskWithKey[] {
  return tasks.map((t) => ({ ...t, _key: `vtask-${++keyCounter}` }));
}

export function VoiceTaskModal({
  open,
  onOpenChange,
  parseResult,
  projects = [],
  onComplete,
}: VoiceTaskModalProps) {
  const [tasks, setTasks] = useState<TaskWithKey[]>([]);
  const [updates, setUpdates] = useState<VoiceParsedUpdate[]>([]);
  const [saving, setSaving] = useState(false);
  const idPrefix = useId();
  const { activeWorkspace, workspaces } = useWorkspace();

  // Sync state when parseResult changes
  useEffect(() => {
    if (parseResult?.tasks) setTasks(withKeys(parseResult.tasks));
    if (parseResult?.updates) setUpdates(parseResult.updates);
  }, [parseResult]);

  const updateTask = useCallback(
    (key: string, field: keyof VoiceParsedTask, value: string | null) => {
      setTasks((prev) => prev.map((t) => (t._key === key ? { ...t, [field]: value } : t)));
    },
    [],
  );

  const removeTask = useCallback((key: string) => {
    setTasks((prev) => prev.filter((t) => t._key !== key));
  }, []);

  const handleSaveAll = useCallback(async () => {
    if (tasks.length === 0 && updates.length === 0) return;
    setSaving(true);

    try {
      // Save new tasks in parallel
      const taskResults = await Promise.allSettled(
        tasks
          .filter((task) => task.title?.trim())
          .map((task) => {
            // Resolve workspace_id: use task-specific slug if provided, else active workspace
            let wsId = activeWorkspace?.id ?? null;
            if (task.workspace_slug) {
              const targetWs = workspaces.find((w) => w.slug === task.workspace_slug);
              if (targetWs) wsId = targetWs.id;
            }
            return fetch(apiUrl('/api/tasks'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: task.title.trim(),
                description: task.description || null,
                priority: task.priority,
                project_id: task.project_id || null,
                status: 'inbox',
                workspace_id: wsId,
                source: 'voice',
              }),
            });
          }),
      );

      const created = taskResults.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
      const taskFailed = taskResults.length - created;

      // Apply updates in parallel
      const updateResults = await Promise.allSettled(
        updates.map(async (update) => {
          const searchRes = await fetch(
            apiUrl(`/api/tasks?search=${encodeURIComponent(update.search_query)}&limit=1`),
          );
          if (!searchRes.ok) return false;
          const matchedTasks: unknown = await searchRes.json();
          if (!Array.isArray(matchedTasks) || matchedTasks.length === 0) return false;
          const first = matchedTasks[0] as Record<string, unknown>;
          if (typeof first?.id !== 'string') return false;

          const changes: Record<string, unknown> = {};
          if (update.changes.status) changes.status = update.changes.status;
          if (update.changes.priority) changes.priority = update.changes.priority;

          const updateRes = await fetch(apiUrl(`/api/tasks/${first.id}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(changes),
          });
          return updateRes.ok;
        }),
      );

      const updated = updateResults.filter(
        (r) => r.status === 'fulfilled' && r.value === true,
      ).length;

      const parts: string[] = [];
      if (created > 0) parts.push(`${created} task${created > 1 ? 's' : ''} created`);
      if (updated > 0) parts.push(`${updated} task${updated > 1 ? 's' : ''} updated`);
      if (taskFailed > 0) parts.push(`${taskFailed} failed`);

      if (taskFailed > 0) {
        toast.warning(parts.join(', '));
      } else {
        toast.success(parts.join(', ') || 'Done');
      }

      onOpenChange(false);
      onComplete?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [tasks, updates, onOpenChange, onComplete]);

  const intent = parseResult?.intent ?? 'none';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {intent === 'create_task' && 'Create Tasks from Voice'}
            {intent === 'brain_dump' && 'Brain Dump — Review Tasks'}
            {intent === 'update_task' && 'Update Tasks'}
            {intent === 'none' && 'No Action Detected'}
          </DialogTitle>
        </DialogHeader>

        {parseResult?.message && (
          <p className="text-foreground-lighter text-sm">{parseResult.message}</p>
        )}

        {/* Task creation list */}
        {(intent === 'create_task' || intent === 'brain_dump') && tasks.length > 0 && (
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {tasks.map((task) => (
              <div key={task._key} className="border-border space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    id={`${idPrefix}-title-${task._key}`}
                    value={task.title}
                    onChange={(e) => updateTask(task._key, 'title', e.target.value)}
                    placeholder="Task title"
                    className="flex-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeTask(task._key)}
                    className="text-foreground-lighter p-1 hover:text-red-400"
                    aria-label={`Remove task: ${task.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={task.priority}
                    onValueChange={(v) => updateTask(task._key, 'priority', v)}
                  >
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p} className="text-xs capitalize">
                          <span className={PRIORITY_COLORS[p]}>{p}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {projects.length > 0 && (
                    <Select
                      value={task.project_id ?? 'none'}
                      onValueChange={(v) =>
                        updateTask(task._key, 'project_id', v === 'none' ? null : v)
                      }
                    >
                      <SelectTrigger className="h-7 flex-1 text-xs">
                        <SelectValue placeholder="No project" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs">
                          No project
                        </SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Update previews */}
        {intent === 'update_task' && updates.length > 0 && (
          <div className="space-y-2">
            {updates.map((update, i) => (
              <div key={update.search_query + i} className="border-border rounded-md border p-3">
                <p className="text-sm">
                  <span className="text-foreground-lighter">Task:</span>{' '}
                  <span className="text-foreground font-medium">{update.search_query}</span>
                </p>
                <div className="mt-1 flex gap-3 text-xs">
                  {update.changes.status && (
                    <span>
                      Status →{' '}
                      <span className="text-brand font-medium">{update.changes.status}</span>
                    </span>
                  )}
                  {update.changes.priority && (
                    <span>
                      Priority → <span className="font-medium">{update.changes.priority}</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* No action */}
        {intent === 'none' && (
          <p className="text-foreground-lighter py-4 text-center text-sm">
            Try saying something like &ldquo;Create a task to fix the login page&rdquo; or
            &ldquo;Mark the auth task done&rdquo;.
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Discard
          </Button>
          {intent !== 'none' && (
            <Button
              size="sm"
              onClick={handleSaveAll}
              disabled={saving || (tasks.length === 0 && updates.length === 0)}
            >
              {saving ? (
                'Saving…'
              ) : (
                <>
                  <Check className="mr-1 h-3.5 w-3.5" />
                  {intent === 'update_task'
                    ? 'Apply Updates'
                    : `Save ${tasks.length} Task${tasks.length !== 1 ? 's' : ''}`}
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
