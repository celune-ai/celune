'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@repo/ui/components/dialog';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Loader2, PenLine, Sparkles } from 'lucide-react';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import { usePlanLimitToast } from '@/hooks/use-plan-limit-toast';
import { parsePlanLimitResponse, PlanLimitError } from '@/lib/plan-limit-error';
import type { Task } from '@repo/types';

type Mode = 'generate' | 'manual';

/** Map API error codes to user-friendly messages. */
function friendlyError(code: string): string {
  const map: Record<string, string> = {
    provider_key_required: 'Add an AI provider key in Settings to use this feature.',
    'AI task generation unavailable': 'AI generation is temporarily unavailable.',
    'Invalid JSON': 'Something went wrong. Please try again.',
    'No text response from AI': 'AI returned an empty response. Please try again.',
    'Request failed': 'Request failed. Please try again.',
  };
  return map[code] ?? code;
}

interface AiTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerating?: () => void;
  onGenerated?: (task: Task) => void;
  onCreated?: (task: Task) => void;
  onError?: (msg: string) => void;
  projectId?: string;
}

export function AiTaskDialog({
  open,
  onOpenChange,
  onGenerating,
  onGenerated,
  onCreated,
  onError,
  projectId,
}: AiTaskDialogProps) {
  const [mode, setMode] = useState<Mode>('generate');

  // Generate mode state
  const [prompt, setPrompt] = useState('');

  // Manual mode state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeWorkspace } = useWorkspace();
  const { handlePlanLimitError } = usePlanLimitToast();

  const resetForm = useCallback(() => {
    setPrompt('');
    setTitle('');
    setDescription('');
    setError(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    onGenerating?.();
    onOpenChange(false);

    try {
      const res = await fetch(apiUrl('/api/tasks/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          project_id: projectId,
          workspace_id: activeWorkspace?.id,
        }),
      });

      if (!res.ok) {
        // Check for plan limit error before generic handling
        const planPayload = await parsePlanLimitResponse(res);
        if (planPayload) throw new PlanLimitError(planPayload);
        const data = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(friendlyError(data.error || `HTTP ${res.status}`));
      }

      const task: Task = await res.json();
      resetForm();
      onGenerated?.(task);
    } catch (err) {
      if (handlePlanLimitError(err)) {
        onOpenChange(true);
        setLoading(false);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to generate task';
      setError(msg);
      onError?.(msg);
      onOpenChange(true);
    } finally {
      setLoading(false);
    }
  }, [
    prompt,
    loading,
    projectId,
    onGenerating,
    onGenerated,
    onError,
    onOpenChange,
    resetForm,
    handlePlanLimitError,
  ]);

  const handleManualCreate = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(apiUrl('/api/tasks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() || null,
          project_id: projectId ?? null,
          workspace_id: activeWorkspace?.id ?? null,
        }),
      });

      if (!res.ok) {
        // Check for plan limit error before generic handling
        const planPayload = await parsePlanLimitResponse(res);
        if (planPayload) throw new PlanLimitError(planPayload);
        const data = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(friendlyError(data.error || `HTTP ${res.status}`));
      }

      const task: Task = await res.json();
      resetForm();
      onOpenChange(false);
      // Use onCreated if provided, fall back to onGenerated for backwards compat
      (onCreated ?? onGenerated)?.(task);
    } catch (err) {
      if (handlePlanLimitError(err)) return;
      const msg = err instanceof Error ? err.message : 'Failed to create task';
      setError(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }, [
    title,
    description,
    loading,
    projectId,
    onCreated,
    onGenerated,
    onError,
    onOpenChange,
    resetForm,
    handlePlanLimitError,
  ]);

  const handleSubmit = mode === 'generate' ? handleGenerate : handleManualCreate;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSubmit = mode === 'generate' ? !!prompt.trim() : !!title.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="sr-only">New task</DialogTitle>
          <div className="border-border flex w-fit items-center rounded-md border">
            <button
              type="button"
              onClick={() => setMode('generate')}
              className={`flex cursor-pointer items-center gap-1.5 rounded-l-[5px] px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'generate'
                  ? 'text-foreground border border-white/50 bg-transparent'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              Generate
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`flex cursor-pointer items-center gap-1.5 rounded-r-[5px] px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'manual'
                  ? 'text-foreground border border-white/50 bg-transparent'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
              }`}
            >
              <PenLine className="h-3 w-3" />
              Manual
            </button>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {mode === 'generate' ? (
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the task in natural language..."
              disabled={loading}
              rows={4}
              className="border-border bg-surface-100 text-foreground placeholder:text-foreground-muted focus:ring-brand w-full resize-none rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
              autoFocus
            />
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-foreground-light text-xs font-medium">Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Task title"
                  disabled={loading}
                  maxLength={500}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-foreground-light text-xs font-medium">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Optional description..."
                  disabled={loading}
                  rows={4}
                  className="border-border bg-surface-100 text-foreground placeholder:text-foreground-muted focus:ring-brand w-full resize-none rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
                />
              </div>
            </>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleSubmit} disabled={loading || !canSubmit}>
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                {mode === 'generate' ? 'Generating…' : 'Creating…'}
              </>
            ) : mode === 'generate' ? (
              'Generate'
            ) : (
              'Create'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
