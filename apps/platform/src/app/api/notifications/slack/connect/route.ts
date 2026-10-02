import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { validateOrigin } from '@/lib/csrf';
import { getAuthUserId } from '@/lib/auth';
import { URL_APP } from '@/lib/branding';
import { generateSlackOAuthState } from '@/lib/oauth-state';
import { deactivateIntegrationMemories } from '@/lib/seed-knowledge-packs';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

const SLACK_CLIENT_ID = process.env['SLACK_CLIENT_ID'];
const APP_URL = process.env['NEXT_PUBLIC_APP_URL'] ?? URL_APP;

// Bot scopes for full multi-tenant Slack app (Events API, commands, messaging)
const SLACK_BOT_SCOPES = [
  'chat:write',
  'chat:write.customize',
  'commands',
  'im:history',
  'im:read',
  'im:write',
  'app_mentions:read',
  'users:read',
].join(',');

// Legacy webhook-only scopes (kept for backward compat during migration)
const SLACK_WEBHOOK_SCOPES = ['incoming-webhook'].join(',');

/**
 * GET /api/notifications/slack/connect?workspace_id=xxx&from=onboarding&mode=bot
 *
 * Initiates Slack OAuth flow. Redirects to Slack's OAuth consent page.
 * Requires admin/owner permission on the workspace.
 *
 * Query params:
 *   workspace_id (required)
 *   from         (optional: 'onboarding' | 'settings') — controls where to redirect after auth
 *   mode         (optional: 'bot' | 'webhook') — 'bot' requests full bot scopes (default), 'webhook' for legacy
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const workspaceId = searchParams.get('workspace_id');
    const from = searchParams.get('from') ?? 'settings';
    const mode = searchParams.get('mode') ?? 'bot';

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const permResult = await requirePermission(request, workspaceId, 'settings:manage');
    if (permResult instanceof NextResponse) return permResult;

    if (!SLACK_CLIENT_ID) {
      return NextResponse.json(
        { error: 'Slack integration not configured. SLACK_CLIENT_ID is missing.' },
        { status: 503 },
      );
    }

    const callbackUrl = `${APP_URL}/api/notifications/slack/callback`;

    // HMAC-signed state with 10-minute expiry (prevents CSRF and tampering)
    const state = generateSlackOAuthState(workspaceId, from);

    const scopes = mode === 'webhook' ? SLACK_WEBHOOK_SCOPES : SLACK_BOT_SCOPES;

    const slackAuthUrl = new URL('https://slack.com/oauth/v2/authorize');
    slackAuthUrl.searchParams.set('client_id', SLACK_CLIENT_ID);
    slackAuthUrl.searchParams.set('scope', scopes);
    slackAuthUrl.searchParams.set('redirect_uri', callbackUrl);
    slackAuthUrl.searchParams.set('state', state);

    return NextResponse.redirect(slackAuthUrl.toString());
  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * DELETE /api/notifications/slack/connect?workspace_id=xxx
 *
 * Disconnects Slack from the workspace (marks is_active = false).
 * Requires admin/owner permission.
 */
export async function DELETE(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(
    request,
    'notifications.slack.connect.delete',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    const permResult = await requirePermission(request, workspaceId, 'settings:manage');
    if (permResult instanceof NextResponse) return permResult;

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Service client: deactivates Slack connection. Accesses: slack_connections.
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('slack_connections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if (error) {
      return safeErrorResponse(error);
    }

    // Deactivate Slack-gated memories for this workspace
    void deactivateIntegrationMemories(workspaceId, 'slack').catch((err) => {
      console.error('[slack/disconnect] memory deactivation failed:', err);
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return safeErrorResponse(err);
  }
}
