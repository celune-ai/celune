import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { verifySentrySignature } from '@/lib/sentry-verify';

export const dynamic = 'force-dynamic';

/**
 * Sentry CRON monitor check-in payload (subset).
 */
interface SentryMonitorPayload {
  data: {
    check_in?: {
      id?: string;
      status: string; // 'ok' | 'error' | 'in_progress' | 'missed' | 'timeout'
      duration?: number;
    };
    monitor?: {
      slug: string;
      name?: string;
      status?: string;
    };
    environment?: string;
  };
  installation?: { uuid?: string };
}

const FAILURE_STATUSES = new Set(['error', 'missed', 'timeout']);

/**
 * POST /api/webhooks/sentry/heartbeat — Receives Sentry CRON monitor webhooks
 *
 * When a monitor check-in fails (error/missed/timeout), logs the event to
 * activity_log with event_type 'ward.heartbeat_failed'.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('sentry-hook-signature');
    const timestamp = request.headers.get('sentry-hook-timestamp');

    const verification = verifySentrySignature(signature, rawBody, timestamp);
    if (!verification.valid) {
      console.error(`[sentry-heartbeat] Verification failed: ${verification.reason}`);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let payload: SentryMonitorPayload;
    try {
      payload = JSON.parse(rawBody) as SentryMonitorPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const checkIn = payload.data?.check_in;
    const monitor = payload.data?.monitor;

    if (!checkIn || !FAILURE_STATUSES.has(checkIn.status)) {
      // Successful check-ins or unrecognised payloads — acknowledge silently
      return NextResponse.json({ received: true });
    }

    const monitorName = monitor?.name ?? monitor?.slug ?? 'unknown';
    const title = `Heartbeat failed: ${monitorName} (${checkIn.status})`.slice(0, 200);

    const workspaceId = payload.installation?.uuid ?? '';

    // Service client: logs Sentry heartbeat failures. Accesses: activity_log.
    const supabase = createServiceClient();
    const { error } = await supabase.from('activity_log').insert({
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
      event_type: 'ward.heartbeat_failed',
      severity: checkIn.status === 'error' ? 'error' : 'warning',
      source: 'sentry-heartbeat',
      title,
      details: JSON.stringify({
        check_in_id: checkIn.id ?? null,
        status: checkIn.status,
        duration: checkIn.duration ?? null,
        monitor_slug: monitor?.slug ?? null,
        monitor_name: monitor?.name ?? null,
        monitor_status: monitor?.status ?? null,
        environment: payload.data?.environment ?? null,
      }),
    });

    if (error) {
      console.error('[sentry-heartbeat] Failed to log heartbeat failure:', error);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[sentry-heartbeat] Unhandled error:', err);
    return NextResponse.json({ received: true, error: 'Processing failed' });
  }
}
