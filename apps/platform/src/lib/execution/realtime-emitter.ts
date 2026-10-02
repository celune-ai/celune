/**
 * Execution Realtime Emitter
 *
 * Broadcasts execution progress events via Supabase Realtime.
 * The worker calls these functions to push updates to the UI.
 * Channel: `execution:{taskId}`
 */

import { createServiceClient } from '@repo/db/service';

export type ExecutionEvent =
  | { type: 'started'; agent_id: string; model: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; tool_name: string; tool_input: unknown }
  | { type: 'tool_result'; tool_name: string; result: string }
  | { type: 'message'; content: string }
  | { type: 'progress'; step: number; tokens_used: number; elapsed_ms: number }
  | { type: 'blocked'; reason: string }
  | { type: 'completed'; outcome: string; tokens_used: number; steps: number }
  | { type: 'failed'; error: string; code?: string }
  | { type: 'heartbeat'; tokens_used: number; step: number };

/**
 * Broadcast an execution event to all subscribers on the task's channel.
 */
export async function broadcastExecutionEvent(taskId: string, event: ExecutionEvent) {
  const supabase = createServiceClient();
  const channel = supabase.channel(`execution:${taskId}`);

  await channel.send({
    type: 'broadcast',
    event: 'execution_event',
    payload: {
      ...event,
      task_id: taskId,
      timestamp: new Date().toISOString(),
    },
  });

  // Clean up the channel after sending
  supabase.removeChannel(channel);
}

/**
 * Create a scoped emitter for a specific execution.
 * Holds the channel open for the duration of the execution.
 */
export function createExecutionEmitter(taskId: string) {
  const supabase = createServiceClient();
  const channel = supabase.channel(`execution:${taskId}`);
  const startTime = Date.now();

  return {
    async emit(event: ExecutionEvent) {
      await channel.send({
        type: 'broadcast',
        event: 'execution_event',
        payload: {
          ...event,
          task_id: taskId,
          timestamp: new Date().toISOString(),
          elapsed_ms: Date.now() - startTime,
        },
      });
    },

    async close() {
      supabase.removeChannel(channel);
    },
  };
}
