import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { reorderTasks, createActivity } from '@repo/db/queries';
import type { TaskStatus, TaskMetadata } from '@repo/types';
import { dispatchNotification } from '@repo/notifications';
import { reorderTaskSchema } from '@/lib/schemas/tasks.schema';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

type ReorderBody = z.infer<typeof reorderTaskSchema>;

export const PUT = withApiSecurity<ReorderBody>(
  async (request: NextRequest, { body, userId }: SecurityContext<ReorderBody>) => {
    const supabase = await createClient();

    // Snapshot current status of all tasks BEFORE reorder so we can detect transitions
    const allIds = body.map((e) => e.id);
    const { data: preTasks } = await supabase
      .from('tasks')
      .select('id, title, status, metadata, assignee, workspace_id')
      .in('id', allIds);

    // Security: verify the caller owns all tasks being reordered
    const taskWorkspaceIds = new Set((preTasks ?? []).map((t) => t.workspace_id).filter(Boolean));
    if (taskWorkspaceIds.size > 0) {
      const { data: memberships } = await supabase
        .from('workspace_memberships')
        .select('workspace_id')
        .eq('user_id', userId)
        .in('workspace_id', [...taskWorkspaceIds]);
      const memberWorkspaces = new Set((memberships ?? []).map((m) => m.workspace_id));
      for (const wsId of taskWorkspaceIds) {
        if (!memberWorkspaces.has(wsId)) {
          return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }
      }
    }

    const preStatusMap = new Map(
      (preTasks ?? []).map((t) => [
        t.id,
        {
          status: t.status as TaskStatus,
          title: t.title,
          metadata: t.metadata,
          assignee: t.assignee,
          workspace_id: t.workspace_id,
        },
      ]),
    );

    // Enrich each reorder entry with workspace_id for cross-org scoping
    const enrichedBody = body.map((entry) => {
      const pre = preStatusMap.get(entry.id);
      return { ...entry, workspace_id: pre?.workspace_id ?? '' };
    });
    await reorderTasks(supabase, enrichedBody);

    const now = new Date().toISOString();

    // Log activity for every status transition (non-critical — use allSettled)
    const activityInserts = body
      .filter((entry) => {
        const pre = preStatusMap.get(entry.id);
        return pre && pre.status !== entry.status;
      })
      .map((entry) => {
        const pre = preStatusMap.get(entry.id)!;
        const meta = (pre.metadata ?? {}) as TaskMetadata;
        const agentId = meta.claimed_by ?? pre.assignee;
        return createActivity(supabase, {
          event_type: 'task.updated',
          severity: 'info',
          source: 'web',
          title: `Task status changed: ${pre.status} → ${entry.status}`,
          task_id: entry.id,
          ...(agentId && agentId !== 'unassigned' ? { agent_id: agentId } : {}),
        });
      });
    await Promise.allSettled(activityInserts);

    // For tasks moving to done via DnD, clear active_session and update agent_status
    const doneEntries = body.filter((e) => {
      const pre = preStatusMap.get(e.id);
      return e.status === 'done' && pre && pre.status !== 'done';
    });

    if (doneEntries.length > 0) {
      const taskOps: PromiseLike<unknown>[] = [];
      const agentOps: PromiseLike<unknown>[] = [];

      for (const entry of doneEntries) {
        const pre = preStatusMap.get(entry.id);
        if (!pre) continue;
        const meta = (pre.metadata ?? {}) as TaskMetadata;

        if (meta.active_session) {
          taskOps.push(
            supabase
              .from('tasks')
              .update({
                metadata: {
                  ...meta,
                  active_session: false,
                  completed_by: meta.claimed_by ?? pre.assignee,
                  work_completed_at: now,
                },
                completed_at: now,
              })
              .eq('id', entry.id),
          );
          if (meta.claimed_by) {
            const wsId = pre.workspace_id;
            const statusRow: Record<string, unknown> = {
              agent_name: meta.claimed_by,
              status: 'online' as const,
              current_task_id: null,
              last_heartbeat: now,
              updated_at: now,
            };
            if (wsId) statusRow.workspace_id = wsId;
            agentOps.push(
              supabase.from('agent_status').upsert(statusRow, {
                onConflict: 'workspace_id,agent_name',
              }),
            );
          }
        } else {
          // Even without active_session, stamp completed_at on DnD to done
          taskOps.push(
            supabase
              .from('tasks')
              .update({ completed_at: now })
              .eq('id', entry.id)
              .is('completed_at', null),
          );
        }
      }

      await Promise.all([...taskOps, ...agentOps]);

      // Dispatch notifications for DnD completions (best-effort)
      for (const entry of doneEntries) {
        const pre = preStatusMap.get(entry.id);
        if (!pre?.workspace_id) continue;
        const meta = (pre.metadata ?? {}) as TaskMetadata;
        dispatchNotification({
          type: 'task.completed',
          workspaceId: pre.workspace_id,
          actorAgent: meta.claimed_by ?? pre.assignee ?? 'rick',
          payload: {
            task_id: entry.id,
            task_title: pre.title,
            outcome: 'Completed via board.',
          },
        }).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true });
  },
  { permission: 'tasks:update', parseBody: reorderTaskSchema },
);
