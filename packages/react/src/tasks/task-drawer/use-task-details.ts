'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCelune } from '../../provider/context';

export interface TaskUsage {
  hasUsage: boolean;
  requests?: number;
  models?: string[];
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  totalCost?: number;
  totalTokens?: number;
  totalDurationMs?: number;
}

/** Loads token usage the first time the details section opens. */
export function useTaskDetails(taskId: string) {
  const { transport } = useCelune();
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<TaskUsage | null>(null);

  const fetchUsage = useCallback(async () => {
    if (!transport.tasks.usage) return;
    try {
      setUsage((await transport.tasks.usage(taskId)) as TaskUsage);
    } catch {
      /* ignore */
    }
  }, [taskId, transport]);

  useEffect(() => {
    if (open && !usage) fetchUsage();
  }, [open, usage, fetchUsage]);

  return { open, setOpen, usage };
}
