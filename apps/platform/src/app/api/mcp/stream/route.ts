/**
 * GET /api/mcp/stream
 *
 * Server-Sent Events (SSE) endpoint for real-time workspace events.
 * Authenticated via API key. Subscribes to Supabase Realtime for:
 *   - Task status changes (tasks table)
 *   - Agent heartbeats (agent_status table)
 *   - Activity log events (activity_log table)
 *
 * Works with ANY client that supports SSE — IDEs, dashboards, CLI tools.
 * Future-proof: when Cursor/Windsurf add Streamable HTTP support, this
 * endpoint can serve as the SSE channel for MCP notifications.
 *
 * Event format (JSON):
 *   { type: "task.updated", data: { id, title, status, ... }, timestamp }
 *   { type: "agent.heartbeat", data: { agent_name, status, ... }, timestamp }
 *   { type: "activity", data: { event_type, title, ... }, timestamp }
 *   { type: "ping", timestamp }  // keepalive every 30s
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max (Vercel limit)

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { authenticateApiKey } from '@/lib/api-key-auth';

// Authenticate and extract workspace context
async function authenticate(request: NextRequest) {
  const result = await authenticateApiKey(request);
  if (!result) {
    return NextResponse.json(
      { error: 'API key required. Pass via Authorization: Bearer <key> header.' },
      { status: 401 },
    );
  }
  if (result instanceof NextResponse) return result;
  return result;
}

export async function GET(request: NextRequest) {
  // Authenticate
  const auth = await authenticate(request);
  if (auth instanceof NextResponse) return auth;

  const { workspaceId } = auth;

  // Create a Supabase client with Realtime capability
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any;

  // Set up SSE response with ReadableStream
  const encoder = new TextEncoder();
  let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Helper to send SSE event
      function send(type: string, data: Record<string, unknown>) {
        if (closed) return;
        try {
          const event = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${event}\n\n`));
        } catch {
          // Stream closed
          closed = true;
        }
      }

      // Send initial connection event
      send('connected', {
        workspace_id: workspaceId,
        channels: ['tasks', 'agent_status', 'activity_log'],
        message: 'Celune real-time stream connected',
      });

      // Subscribe to task changes
      const taskChannel = supabase
        .channel(`tasks:${workspaceId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'tasks',
            filter: `workspace_id=eq.${workspaceId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            const eventType =
              payload.eventType === 'INSERT'
                ? 'task.created'
                : payload.eventType === 'UPDATE'
                  ? 'task.updated'
                  : 'task.deleted';

            const record = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
            const old = (payload.old ?? {}) as Record<string, unknown>;

            send(eventType, {
              id: record.id,
              title: record.title,
              status: record.status,
              previous_status: old.status ?? null,
              assignee: record.assignee,
              priority: record.priority,
              outcome: record.outcome ?? null,
            });
          },
        )
        .subscribe();

      // Subscribe to agent status changes
      const agentChannel = supabase
        .channel(`agents:${workspaceId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'agent_status',
            filter: `workspace_id=eq.${workspaceId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            const record = (payload.new ?? {}) as Record<string, unknown>;
            const old = (payload.old ?? {}) as Record<string, unknown>;

            send('agent.status_changed', {
              agent_name: record.agent_name,
              status: record.status,
              previous_status: old.status ?? null,
              current_task_id: record.current_task_id ?? null,
              last_heartbeat: record.last_heartbeat,
            });
          },
        )
        .subscribe();

      // Subscribe to activity log (recent events)
      const activityChannel = supabase
        .channel(`activity:${workspaceId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'activity_log',
            filter: `workspace_id=eq.${workspaceId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            const record = (payload.new ?? {}) as Record<string, unknown>;

            send('activity', {
              event_type: record.event_type,
              title: record.title,
              severity: record.severity,
              agent_id: record.agent_id ?? null,
              task_id: record.task_id ?? null,
              metadata: record.metadata ?? null,
            });
          },
        )
        .subscribe();

      // Keepalive ping every 30 seconds
      keepaliveInterval = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ping\ndata: {"type":"ping","timestamp":"${new Date().toISOString()}"}\n\n`,
            ),
          );
        } catch {
          closed = true;
        }
      }, 30_000);

      // Clean up when client disconnects
      request.signal.addEventListener('abort', () => {
        closed = true;
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        supabase.removeChannel(taskChannel);
        supabase.removeChannel(agentChannel);
        supabase.removeChannel(activityChannel);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },

    cancel() {
      closed = true;
      if (keepaliveInterval) clearInterval(keepaliveInterval);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
