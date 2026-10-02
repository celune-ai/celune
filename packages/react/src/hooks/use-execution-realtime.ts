'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCelune } from '../provider/context';
import type { ExecutionRecord } from '../transport/types';

export interface ExecutionEvent {
  type: string;
  task_id: string;
  timestamp: string;
  elapsed_ms?: number;
  agent_id?: string;
  model?: string;
  content?: string;
  tool_name?: string;
  tool_input?: unknown;
  result?: string;
  outcome?: string;
  error?: string;
  code?: string;
  reason?: string;
  step?: number;
  tokens_used?: number;
  steps?: number;
  source?: string;
}

const ACTIVE = new Set(['pending', 'claimed', 'streaming']);

/**
 * Turns a change in the newest run's status into one coarse event. Returns null
 * when nothing changed, or when the first poll finds a run that already ended.
 */
export function runStatusEvent(
  run: ExecutionRecord,
  previous: { id: string; status: string } | null,
  taskId: string,
): ExecutionEvent | null {
  if (previous && previous.id === run.id && previous.status === run.status) return null;
  const now = new Date().toISOString();
  const agentId = typeof run.agent_id === 'string' ? run.agent_id : undefined;
  const base = { task_id: taskId, timestamp: now, agent_id: agentId, source: 'poll' };
  if (ACTIVE.has(run.status)) {
    const alreadyActive = previous?.id === run.id && ACTIVE.has(previous.status);
    if (alreadyActive) return null;
    const model = typeof run.model === 'string' ? run.model : 'server run';
    return { ...base, type: 'started', model };
  }
  if (!previous) return null;
  const tokens = typeof run.tokens_used === 'number' ? run.tokens_used : undefined;
  switch (run.status) {
    case 'completed':
      return {
        ...base,
        type: 'completed',
        tokens_used: tokens,
        outcome: typeof run.outcome === 'string' ? run.outcome : undefined,
      };
    case 'failed':
      return {
        ...base,
        type: 'failed',
        error: typeof run.error_message === 'string' ? run.error_message : 'Run failed',
        code: typeof run.error_code === 'string' ? run.error_code : undefined,
      };
    case 'cancelled':
      return { ...base, type: 'failed', error: 'Cancelled', code: 'cancelled' };
    case 'expired':
      return { ...base, type: 'timeout' };
    default:
      return null;
  }
}

interface UseExecutionRealtimeOpts {
  taskId: string | null;
  enabled?: boolean;
}

/**
 * Live execution events for one task. With a `subscribe` adapter it streams
 * every step. Without one it polls the transport's executions list and emits
 * coarse started, completed, failed, and timeout events from run status.
 */
export function useExecutionRealtime({ taskId, enabled = true }: UseExecutionRealtimeOpts) {
  const { subscribe, transport, pollInterval } = useCelune();
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [latestEvent, setLatestEvent] = useState<ExecutionEvent | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
  }, []);

  useEffect(() => {
    if (!taskId || !enabled || !subscribe) return;

    return subscribe(
      { broadcast: { channel: `execution:${taskId}`, event: 'execution_event' } },
      (change) => {
        const event = change.new as unknown as ExecutionEvent | null;
        if (!event) return;
        setLatestEvent(event);
        setEvents((prev) => [...prev, event]);

        if (event.type === 'started') {
          setIsRunning(true);
        } else if (['completed', 'failed', 'timeout'].includes(event.type)) {
          setIsRunning(false);
        }
      },
    );
  }, [taskId, enabled, subscribe]);

  const executions = transport.executions;
  useEffect(() => {
    if (!taskId || !enabled || subscribe || !executions || pollInterval <= 0) return;
    let cancelled = false;
    let previous: { id: string; status: string } | null = null;

    const poll = async () => {
      let rows: ExecutionRecord[];
      try {
        rows = await executions.list({ taskId, limit: 1 });
      } catch {
        return;
      }
      const run = rows[0];
      if (cancelled || !run) return;
      const event = runStatusEvent(run, previous, taskId);
      previous = { id: run.id, status: run.status };
      if (!event) return;
      setLatestEvent(event);
      setEvents((prev) => [...prev, event]);
      setIsRunning(event.type === 'started');
    };

    void poll();
    const timer = setInterval(poll, pollInterval);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId, enabled, subscribe, executions, pollInterval]);

  return { events, isRunning, latestEvent, clearEvents };
}
