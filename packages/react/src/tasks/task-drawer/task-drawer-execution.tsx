'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Wrench,
  MessageSquare,
  AlertTriangle,
  Square,
  Clock,
  Zap,
  Brain,
} from 'lucide-react';
import { useExecutionRealtime } from '../../hooks/use-execution-realtime';
import type { ExecutionEvent } from '../../hooks/use-execution-realtime';
import type { Task } from '@repo/types';
import { useCelune } from '../../provider/context';

interface TaskDrawerExecutionProps {
  task: Task;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function EventIcon({ type }: { type: string }) {
  switch (type) {
    case 'started':
      return <Loader2 className="h-3 w-3 animate-spin text-(--celune-status-scoping)" />;
    case 'message':
    case 'thinking':
      return <MessageSquare className="h-3 w-3 text-(--celune-fg-muted)" />;
    case 'tool_call':
      return <Wrench className="h-3 w-3 text-(--celune-status-review)" />;
    case 'tool_result':
      return <CheckCircle2 className="h-3 w-3 text-(--celune-status-done)" />;
    case 'completed':
      return <CheckCircle2 className="h-3 w-3 text-(--celune-primary)" />;
    case 'failed':
    case 'error':
      return <XCircle className="h-3 w-3 text-(--celune-danger)" />;
    case 'blocked':
      return <AlertTriangle className="h-3 w-3 text-(--celune-status-review)" />;
    case 'progress':
      return <Zap className="h-3 w-3 text-(--celune-fg-muted)" />;
    default:
      return <Clock className="h-3 w-3 text-(--celune-fg-muted)" />;
  }
}

function EventRow({ event }: { event: ExecutionEvent }) {
  const label = (() => {
    switch (event.type) {
      case 'started':
        return `Agent ${event.agent_id} started (${event.model})`;
      case 'message':
        return event.content?.slice(0, 120) ?? 'Thinking...';
      case 'tool_call':
        return `Calling ${event.tool_name}`;
      case 'tool_result':
        return `${event.tool_name}: ${event.result?.slice(0, 80) ?? 'done'}`;
      case 'completed':
        return `Completed — ${event.tokens_used?.toLocaleString()} tokens`;
      case 'failed':
        return `Failed: ${event.error}`;
      case 'blocked':
        return `Blocked: ${event.reason}`;
      case 'progress':
        return `Step ${event.step} — ${event.tokens_used?.toLocaleString()} tokens`;
      default:
        return event.type;
    }
  })();

  return (
    <div className="flex items-start gap-2 py-1">
      <div className="mt-0.5 shrink-0">
        <EventIcon type={event.type} />
      </div>
      <span className="text-xs leading-relaxed text-(--celune-fg-muted)">{label}</span>
    </div>
  );
}

interface HistoricalExecution {
  id: string;
  status: string;
  agent_id: string | null;
  tokens_used: number | null;
  outcome: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
}

export function TaskDrawerExecution({ task }: TaskDrawerExecutionProps) {
  const { transport } = useCelune();
  const meta = (task.metadata ?? {}) as Record<string, unknown>;
  const isInitiated = meta.initiated === true;
  const taskId = task.id;

  const { events, isRunning, latestEvent } = useExecutionRealtime({
    taskId,
    enabled: isInitiated,
  });

  const [stopping, setStopping] = useState(false);
  const [historicalExecutions, setHistoricalExecutions] = useState<HistoricalExecution[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch historical executions from execution_queue
  useEffect(() => {
    if (!taskId || !task.workspace_id || !transport.executions) return;
    transport.executions
      .list({ taskId, workspaceId: task.workspace_id, limit: 10 })
      .then((rows) => setHistoricalExecutions(rows as unknown as HistoricalExecution[]))
      .catch(() => {});
  }, [taskId, task.workspace_id, transport]);

  // Auto-scroll to latest event
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  // Determine if any execution has external source
  const hasExternalSource =
    historicalExecutions.some((e) => e.metadata?.source === 'second-brain') ||
    events.some((e) => e.source === 'second-brain');

  // Don't show if no activity at all
  if (!isInitiated && events.length === 0 && historicalExecutions.length === 0) return null;

  const handleStop = async () => {
    setStopping(true);
    try {
      // Find the active execution for this task and cancel it
      await transport.executions?.cancel({
        taskId,
        workspaceId: task.workspace_id ?? undefined,
      });
    } catch {
      console.error('Failed to stop execution');
    } finally {
      setStopping(false);
    }
  };

  const tokensUsed = latestEvent?.tokens_used ?? 0;
  const elapsed = latestEvent?.elapsed_ms ?? 0;

  return (
    <div className="rounded-lg border border-(--celune-border) bg-(--celune-surface) p-3">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-(--celune-status-scoping)" />
          ) : latestEvent?.type === 'completed' ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-(--celune-primary)" />
          ) : latestEvent?.type === 'failed' ? (
            <XCircle className="h-3.5 w-3.5 text-(--celune-danger)" />
          ) : (
            <Clock className="h-3.5 w-3.5 text-(--celune-fg-muted)" />
          )}
          <span className="text-xs font-(weight:--celune-font-weight-medium)">
            {isRunning
              ? 'Agent Working'
              : latestEvent?.type === 'completed'
                ? 'Execution Complete'
                : latestEvent?.type === 'failed'
                  ? 'Execution Failed'
                  : 'Execution'}
          </span>
          {hasExternalSource && (
            <span className="inline-flex items-center gap-1 rounded bg-(--celune-surface-hover) px-1.5 py-0.5 text-(length:--celune-text-3xs) text-(--celune-fg-muted)">
              <Brain className="h-3 w-3" />
              brain
            </span>
          )}
        </div>

        {isRunning && (
          <button
            onClick={handleStop}
            disabled={stopping}
            className="flex items-center gap-1 text-xs text-(--celune-fg-muted) transition-colors hover:text-(--celune-fg)"
          >
            <Square className="h-3 w-3" />
            {stopping ? 'Stopping...' : 'Stop'}
          </button>
        )}
      </div>

      {/* Stats bar */}
      {(tokensUsed > 0 || elapsed > 0) && (
        <div className="mb-2 flex gap-3 text-(length:--celune-text-2xs) text-(--celune-fg-muted)">
          {tokensUsed > 0 && <span>{tokensUsed.toLocaleString()} tokens</span>}
          {elapsed > 0 && <span>{formatElapsed(elapsed)}</span>}
          {events.length > 0 && <span>{events.length} steps</span>}
        </div>
      )}

      {/* Event log */}
      <div ref={scrollRef} className="scrollbar-dark max-h-[200px] overflow-y-auto">
        {events
          .filter((e) => e.type !== 'progress' && e.type !== 'heartbeat')
          .map((event, i) => (
            <EventRow key={i} event={event} />
          ))}
        {events.length === 0 && isInitiated && (
          <p className="py-2 text-center text-xs text-(--celune-fg-muted) italic">
            Waiting for agent to start...
          </p>
        )}
      </div>

      {/* Historical executions (bridge and past runs) */}
      {historicalExecutions.length > 0 && events.length === 0 && (
        <div className="mt-2 space-y-1.5 border-t border-(--celune-border) pt-2">
          {historicalExecutions.map((exec) => (
            <div key={exec.id} className="flex items-center gap-2 text-xs">
              {exec.status === 'completed' ? (
                <CheckCircle2 className="h-3 w-3 shrink-0 text-(--celune-primary)" />
              ) : exec.status === 'failed' ? (
                <XCircle className="h-3 w-3 shrink-0 text-(--celune-danger)" />
              ) : exec.status === 'processing' ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-(--celune-status-scoping)" />
              ) : (
                <Clock className="h-3 w-3 shrink-0 text-(--celune-fg-muted)" />
              )}
              <span className="truncate text-(--celune-fg-muted)">
                {exec.metadata?.description
                  ? String(exec.metadata.description)
                  : (exec.outcome?.slice(0, 80) ?? exec.status)}
              </span>
              {exec.metadata?.source === 'second-brain' && (
                <Brain className="h-3 w-3 shrink-0 text-(--celune-fg-muted)" />
              )}
              {exec.tokens_used ? (
                <span className="ml-auto shrink-0 text-(length:--celune-text-3xs) text-(--celune-fg-muted)">
                  {exec.tokens_used.toLocaleString()} tok
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
