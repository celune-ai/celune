import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { verifySentrySignature } from '@/lib/sentry-verify';
import { processError } from '@/lib/ward/pipeline';
import { DEFAULT_WARD_CONFIG } from '@/lib/ward/config';

export const dynamic = 'force-dynamic';

/**
 * Sentry issue alert payload shape (subset we care about).
 */
interface SentryIssue {
  id: string;
  title: string;
  culprit?: string;
  level: string;
  status: string;
  firstSeen: string;
  lastSeen: string;
  count: string;
  metadata?: { type?: string; value?: string };
  project?: { id?: string; name?: string; slug?: string };
}

interface SentryIssuePayload {
  action: string;
  data: {
    issue: SentryIssue;
  };
  installation?: { uuid?: string };
}

/**
 * POST /api/webhooks/sentry — Receives Sentry issue alert webhooks
 *
 * Verifies the HMAC-SHA256 signature, extracts issue details, and logs
 * the error to activity_log with event_type 'ward.error_received'.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('sentry-hook-signature');
    const timestamp = request.headers.get('sentry-hook-timestamp');

    const verification = verifySentrySignature(signature, rawBody, timestamp);
    if (!verification.valid) {
      console.error(`[sentry-webhook] Verification failed: ${verification.reason}`);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let payload: SentryIssuePayload;
    try {
      payload = JSON.parse(rawBody) as SentryIssuePayload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const issue = payload.data?.issue;
    if (!issue) {
      // Sentry sends installation/setup hooks with no issue — acknowledge them
      return NextResponse.json({ received: true });
    }

    const title = issue.title
      ? `Sentry error: ${issue.title}`.slice(0, 200)
      : 'Sentry error (untitled)';

    // Resolve workspace from Sentry installation UUID — fail closed if unrecognized
    const installationUuid = payload.installation?.uuid;
    let workspaceId = '';

    // Service client: validates installation UUID + logs events. Accesses: workspace_integrations, activity_log.
    const supabase = createServiceClient();

    if (installationUuid) {
      // Verify the installation UUID maps to a real workspace
      const { data: integration } = await supabase
        .from('sentry_installations')
        .select('workspace_id')
        .eq('installation_uuid', installationUuid)
        .eq('is_active', true)
        .maybeSingle();

      if (integration?.workspace_id) {
        workspaceId = integration.workspace_id;
      } else {
        console.warn(
          `[sentry-webhook] Unrecognized installation UUID: ${installationUuid} — skipping WARD pipeline`,
        );
      }
    }

    const { error } = await supabase.from('activity_log').insert({
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
      event_type: 'ward.error_received',
      severity:
        issue.level === 'fatal' ? 'critical' : issue.level === 'error' ? 'error' : 'warning',
      source: 'sentry-webhook',
      title,
      details: JSON.stringify({
        sentry_issue_id: issue.id,
        culprit: issue.culprit ?? null,
        level: issue.level,
        status: issue.status,
        first_seen: issue.firstSeen,
        last_seen: issue.lastSeen,
        count: issue.count,
        metadata_type: issue.metadata?.type ?? null,
        metadata_value: issue.metadata?.value ?? null,
        project_name: issue.project?.name ?? null,
        project_slug: issue.project?.slug ?? null,
        action: payload.action,
      }),
    });

    if (error) {
      console.error('[sentry-webhook] Failed to log error:', error);
    }

    // Run WARD pipeline asynchronously so the webhook responds within Sentry's timeout
    after(async () => {
      try {
        if (!workspaceId) {
          console.warn('[sentry-webhook] No workspace ID — skipping WARD pipeline');
          return;
        }

        await processError(
          workspaceId,
          issue.id,
          {
            title: issue.title,
            culprit: issue.culprit ?? 'unknown',
            level: issue.level,
            projectSlug: issue.project?.slug,
            metadata: issue.metadata as Record<string, unknown> | undefined,
          },
          DEFAULT_WARD_CONFIG,
        );
      } catch (err) {
        console.error('[sentry-webhook] WARD pipeline error:', err);
      }
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[sentry-webhook] Unhandled error:', err);
    // Always return 200 to prevent Sentry from excessive retries
    return NextResponse.json({ received: true, error: 'Processing failed' });
  }
}
