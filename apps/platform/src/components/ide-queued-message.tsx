'use client';

import { Loader2, Monitor } from 'lucide-react';

interface IdeQueuedMessageProps {
  jobId?: string;
  message?: string;
}

/**
 * Shown when any API returns `{ execution_mode: 'ide_queue', job_id, message }`.
 * Displays a pending state so the user knows their IDE is processing the request.
 */
export function IdeQueuedMessage({ jobId, message }: IdeQueuedMessageProps) {
  return (
    <div className="border-border bg-surface-200 flex items-start gap-3 rounded-lg border p-4">
      <div className="bg-brand/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
        <Monitor className="text-brand h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-foreground text-sm font-medium">
          {message ?? 'Your IDE is processing this request...'}
        </p>
        <div className="text-foreground-lighter flex items-center gap-2 text-xs">
          <Loader2 className="text-brand h-3 w-3 animate-spin" />
          <span>Waiting for IDE response</span>
        </div>
        {jobId && <p className="text-foreground-lighter font-mono text-[11px]">Job: {jobId}</p>}
      </div>
    </div>
  );
}
