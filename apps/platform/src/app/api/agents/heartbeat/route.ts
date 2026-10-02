/**
 * POST /api/agents/heartbeat
 *
 * Continuous heartbeat ping endpoint. Agents call this periodically to report
 * their status. Updates agent_status and logs state transitions to heartbeat_events.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { dispatchNotification } from '@repo/notifications';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const heartbeatSchema = z.object({
  workspace_id: z.string().uuid(),
  agent_id: z.string().min(1),
  status: z.enum(['online', 'working', 'idle', 'offline']),
  current_task_id: z.string().uuid().nullable().optional(),
  model: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type HeartbeatBody = z.infer<typeof heartbeatSchema>;

export const POST = withApiSecurity<HeartbeatBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<HeartbeatBody>) => {
    const { workspace_id, agent_id, status, current_task_id, model, metadata } = body;

    const supabase = createServiceClient();

    // Verify workspace membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const now = new Date().toISOString();

    // Read current status to detect transitions
    const { data: current } = await supabase
      .from('agent_status')
      .select('status')
      .eq('workspace_id', workspace_id)
      .eq('agent_name', agent_id)
      .maybeSingle();

    const previousStatus = current?.status ?? null;

    // Upsert agent_status
    const { error: upsertError } = await supabase.from('agent_status').upsert(
      {
        workspace_id,
        agent_name: agent_id,
        status,
        last_heartbeat: now,
        current_task_id: current_task_id ?? null,
        model: model ?? null,
        user_id: userId,
        metadata: metadata ?? null,
      },
      { onConflict: 'workspace_id,agent_name' },
    );

    if (upsertError) {
      console.error('[heartbeat] upsert failed:', upsertError.message);
      return NextResponse.json({ error: 'Failed to update heartbeat' }, { status: 500 });
    }

    // Log state transition to heartbeat_events (only if status changed)
    if (previousStatus !== null && previousStatus !== status) {
      await supabase
        .from('heartbeat_events')
        .insert({
          workspace_id,
          agent_id,
          event_type: status,
          metadata: {
            previous_status: previousStatus,
            current_task_id: current_task_id ?? null,
            model: model ?? null,
          },
        })
        .then(({ error }) => {
          if (error) console.error('[heartbeat] event insert failed:', error.message);
        });

      // Dispatch agent.status_changed notification (best-effort)
      dispatchNotification({
        type: 'agent.status_changed',
        workspaceId: workspace_id,
        actorAgent: agent_id,
        payload: {
          agent_id,
          previous_status: previousStatus,
          new_status: status,
          current_task_id: current_task_id ?? null,
        },
      }).catch(() => {});

      // Route agent failures to WARD error intake for investigation
      if (status === 'offline' && previousStatus === 'working') {
        const { processError } = await import('@/lib/ward/pipeline');
        processError(workspace_id, `heartbeat_${agent_id}_${Date.now()}`, {
          title: `Agent ${agent_id} went offline while working`,
          culprit: `agents/heartbeat/${agent_id}`,
          level: 'warning',
          metadata: {
            agent_id,
            previous_status: previousStatus,
            current_task_id: current_task_id ?? null,
          },
        }).catch((err: unknown) => {
          console.error('[heartbeat] WARD intake failed:', err);
        });
      }
    }

    return NextResponse.json({
      agent_id,
      status,
      last_heartbeat: now,
    });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'agents.heartbeat.post' },
    permission: 'agents:configure',
    parseBody: heartbeatSchema,
  },
);
