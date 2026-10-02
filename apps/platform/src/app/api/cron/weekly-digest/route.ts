import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as crypto from 'node:crypto';
import { createServiceClient } from '@repo/db/service';
import { sendAgentReport } from '@repo/agentmail';
import { renderWeeklyDigest } from '@repo/notifications';
import { URL_APP } from '@/lib/branding';

export const dynamic = 'force-dynamic';

// This route is called by Vercel Cron every Sunday at 08:00 UTC.
// Configure in vercel.json:
//   { "crons": [{ "path": "/api/cron/weekly-digest", "schedule": "0 8 * * 0" }] }

const CRON_SECRET = process.env['CRON_SECRET'];

function isAuthorized(request: NextRequest): boolean {
  // Vercel Cron sets Authorization: Bearer <CRON_SECRET>
  const auth = request.headers.get('authorization');
  if (!auth || !CRON_SECRET) return false;
  const expected = `Bearer ${CRON_SECRET}`;
  if (auth.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

interface WorkspaceRecord {
  id: string;
  name: string;
}

interface ActivityRecord {
  event_type: string;
  title: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface NotificationPreference {
  user_id: string;
  email_address: string | null;
  frequency: string;
  is_enabled: boolean;
}

/**
 * POST /api/cron/weekly-digest
 *
 * Vercel Cron handler. Scheduled: 0 8 * * 0 (Sundays 08:00 UTC)
 *
 * For each workspace with at least one user on weekly-digest frequency:
 *   1. Query activity_log for the past 7 days
 *   2. Group events by agent
 *   3. Render the weekly-digest template
 *   4. Send via AgentMail from SAGE inbox
 *   5. Log the send
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekOf = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Service client: weekly digest cron. Accesses: notification_preferences, activity_log, workspaces.
  const supabase = createServiceClient();

  let workspacesProcessed = 0;
  let digestsSent = 0;
  let digestsFailed = 0;

  try {
    // Find all workspaces with digest-frequency email preferences
    const { data: digestPrefs, error: prefError } = await supabase
      .from('notification_preferences')
      .select('user_id, workspace_id, email_address, frequency, is_enabled')
      .eq('channel', 'email')
      .eq('frequency', 'digest_weekly')
      .eq('is_enabled', true);

    if (prefError) {
      console.error('[weekly-digest] Failed to load preferences:', prefError.message);
      return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
    }

    if (!digestPrefs || digestPrefs.length === 0) {
      return NextResponse.json({ processed: 0, sent: 0, message: 'No weekly digest subscribers' });
    }

    // Group by workspace
    const byWorkspace = new Map<string, typeof digestPrefs>();
    for (const pref of digestPrefs) {
      const ws = pref.workspace_id;
      if (!byWorkspace.has(ws)) byWorkspace.set(ws, []);
      byWorkspace.get(ws)!.push(pref as NotificationPreference & { workspace_id: string });
    }

    for (const [workspaceId, prefs] of byWorkspace) {
      workspacesProcessed++;

      // Fetch workspace name
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('id, name')
        .eq('id', workspaceId)
        .single();

      const workspaceName = (workspace as WorkspaceRecord | null)?.name ?? 'your workspace';

      // Fetch activity log for the past 7 days
      const { data: activities } = await supabase
        .from('activity_log')
        .select('event_type, title, details, created_at')
        .eq('workspace_id', workspaceId)
        .gte('created_at', weekAgo)
        .not('event_type', 'like', 'notification.%') // exclude notification meta-events
        .order('created_at', { ascending: false })
        .limit(500);

      const activityRows = (activities as ActivityRecord[] | null) ?? [];

      // Group events by agent
      const agentMap = new Map<string, { type: string; title: string; completed_at: string }[]>();
      for (const row of activityRows) {
        const agent =
          (row.details?.actor_agent as string) || (row.details?.agent as string) || 'system';
        if (!agentMap.has(agent)) agentMap.set(agent, []);
        agentMap.get(agent)!.push({
          type: row.event_type,
          title: row.title,
          completed_at: row.created_at,
        });
      }

      const eventsByAgent = Array.from(agentMap.entries()).map(([agent, events]) => ({
        agent,
        events,
      }));

      const totals = {
        tasks_completed: activityRows.filter((r) => r.event_type === 'task.completed').length,
        tasks_blocked: activityRows.filter((r) => r.event_type === 'task.blocked').length,
        reviews_completed: activityRows.filter((r) => r.event_type === 'review.completed').length,
        deploys: activityRows.filter(
          (r) => r.event_type === 'deploy.triggered' || r.event_type === 'deploy.completed',
        ).length,
      };

      const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? URL_APP;
      const { subject, markdown } = renderWeeklyDigest({
        week_of: weekOf,
        workspace_name: workspaceName,
        dashboard_url: `${appUrl}/w/${workspaceId}`,
        events_by_agent: eventsByAgent,
        totals,
      });

      // Send to each subscriber in this workspace
      for (const pref of prefs) {
        let toAddress = pref.email_address;
        if (!toAddress) {
          const { data: userRecord } = await supabase.auth.admin.getUserById(pref.user_id);
          toAddress = userRecord.user?.email ?? null;
        }
        if (!toAddress) continue;

        const result = await sendAgentReport({
          from: 'sage',
          to: toAddress,
          subject,
          markdown,
        });

        if (result.ok) {
          digestsSent++;
          // Log the send
          await supabase.from('activity_log').insert({
            event_type: 'notification.sent',
            workspace_id: workspaceId,
            source: 'cron:weekly-digest',
            title: `Weekly digest sent to ${toAddress}`,
            details: { channel: 'email', notification_event_type: 'digest.weekly' },
          });
        } else {
          digestsFailed++;
          console.error('[weekly-digest] Send failed:', result.error, 'to:', toAddress);
        }
      }
    }

    return NextResponse.json({
      success: true,
      workspaces_processed: workspacesProcessed,
      digests_sent: digestsSent,
      digests_failed: digestsFailed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[weekly-digest] Unexpected error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
