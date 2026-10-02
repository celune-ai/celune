import { type NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  shortId: string;
  level: 'error' | 'warning' | 'info' | 'fatal';
  status: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  project: {
    slug: string;
    name: string;
  };
  type: string;
  platform: string;
}

export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'alerts.sentry.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  const userId = getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authToken = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT ?? 'javascript-nextjs';

  if (!authToken || !org) {
    return NextResponse.json({ issues: [], error: 'Sentry not configured' }, { status: 200 });
  }

  try {
    const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=is:unresolved&sort=date&limit=25`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { issues: [], error: `Sentry API error (${res.status}): ${text.slice(0, 200)}` },
        { status: 200 },
      );
    }

    const issues: SentryIssue[] = await res.json();

    // Map to a shape the alerts page can consume
    const mapped = issues.map((issue) => ({
      id: `sentry-${issue.id}`,
      title: issue.title,
      severity: issue.level === 'fatal' ? 'error' : issue.level,
      event_type: issue.metadata?.type ?? issue.type ?? 'exception',
      source: 'sentry',
      created_at: issue.lastSeen,
      first_seen: issue.firstSeen,
      last_seen: issue.lastSeen,
      count: parseInt(issue.count, 10),
      culprit: issue.culprit,
      permalink: issue.permalink,
      short_id: issue.shortId,
      status: issue.status,
      metadata_type: issue.metadata?.type,
      metadata_value: issue.metadata?.value,
      metadata_filename: issue.metadata?.filename,
      metadata_function: issue.metadata?.function,
      platform: issue.platform,
    }));

    return NextResponse.json({ issues: mapped });
  } catch (error) {
    console.error('[API Error]', error);
    return NextResponse.json(
      { issues: [], error: 'Failed to fetch Sentry issues' },
      { status: 200 },
    );
  }
}
