import { NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { upsertHealthAlert } from '@repo/db/queries';
import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';

interface HealthCheckResult {
  heartbeat?: { status: string };
  slackbot?: { status: string };
  feed_scanner?: { status: string };
  memory_db?: { status: string };
  api_credits?: { status: string };
}

const ALERT_RULES: {
  key: keyof HealthCheckResult;
  condition: (val: { status: string }) => boolean;
  event_type: string;
  severity: 'warning' | 'error';
  title: string;
}[] = [
  {
    key: 'heartbeat',
    condition: (v) => v.status !== 'ok',
    event_type: 'integration.heartbeat.down',
    severity: 'warning',
    title: 'Heartbeat check is down',
  },
  {
    key: 'slackbot',
    condition: (v) => v.status === 'offline',
    event_type: 'integration.slack.offline',
    severity: 'error',
    title: 'Slack bot is offline',
  },
  {
    key: 'api_credits',
    condition: (v) => v.status === 'exhausted',
    event_type: 'integration.api.credits_exhausted',
    severity: 'error',
    title: 'Anthropic API credits exhausted',
  },
  {
    key: 'feed_scanner',
    condition: (v) => v.status !== 'ok',
    event_type: 'integration.feed.down',
    severity: 'warning',
    title: 'Feed scanner is down',
  },
  {
    key: 'memory_db',
    condition: (v) => v.status === 'error',
    event_type: 'integration.memory_db.error',
    severity: 'error',
    title: 'Memory database error',
  },
];

export async function POST(request: Request) {
  try {
    // Require CRON_SECRET for automated health checks — fail closed
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
    }
    const authHeader = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${cronSecret}`;
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Call health check logic directly via service client (avoids internal HTTP call
    // that would be blocked by auth middleware)
    const supabase = createServiceClient();
    const { data: healthRows } = await supabase
      .from('health_checks')
      .select('service, status')
      .order('checked_at', { ascending: false })
      .limit(10);

    const healthData: HealthCheckResult = {};
    if (healthRows) {
      const seen = new Set<string>();
      for (const row of healthRows) {
        if (!seen.has(row.service)) {
          seen.add(row.service);
          healthData[row.service as keyof HealthCheckResult] = { status: row.status };
        }
      }
    }

    const results: { event_type: string; action: string; instance_count: number }[] = [];

    for (const rule of ALERT_RULES) {
      const check = healthData[rule.key];
      if (!check) continue;

      if (rule.condition(check)) {
        const result = await upsertHealthAlert(supabase, {
          event_type: rule.event_type,
          severity: rule.severity,
          title: rule.title,
          source: 'health',
          details: { check_status: check.status },
        });
        results.push({
          event_type: rule.event_type,
          action: result.action,
          instance_count: result.instance_count,
        });
      }
    }

    return NextResponse.json({ checked: true, alerts: results });
  } catch (err) {
    console.error('[API Error]', err);
    return NextResponse.json({ error: 'Check-and-alert failed' }, { status: 500 });
  }
}
