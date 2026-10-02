import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { URL_APP } from '@/lib/branding';
import { parseSlackOAuthState } from '@/lib/oauth-state';
import { encryptProviderKey } from '@/lib/provider-key-crypto';
import { resolvePermissions } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const SLACK_CLIENT_ID = process.env['SLACK_CLIENT_ID'];
const SLACK_CLIENT_SECRET = process.env['SLACK_CLIENT_SECRET'];
const APP_URL = process.env['NEXT_PUBLIC_APP_URL'] ?? URL_APP;

interface SlackConnectionUpsert {
  workspace_id: string;
  slack_team_id: string;
  slack_team_name: string;
  connected_by: string;
  celune_user_id: string;
  is_active: boolean;
  updated_at: string;
  // Bot token fields
  bot_token_encrypted?: string;
  bot_token_iv?: string;
  bot_user_id?: string | null;
  app_id?: string | null;
  installed_scopes?: string[];
  installation_type?: 'bot' | 'webhook';
  installer_slack_user_id?: string | null;
  incoming_webhook_url?: string | null;
  // Webhook fields
  slack_channel?: string;
  slack_channel_id?: string;
  encrypted_webhook_url?: string;
  webhook_iv?: string;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: {
    id: string;
    name: string;
  };
  authed_user?: {
    id: string;
    scope: string;
    access_token: string;
    token_type: string;
  };
  incoming_webhook?: {
    channel: string;
    channel_id: string;
    configuration_url: string;
    url: string;
  };
}

/**
 * GET /api/notifications/slack/callback
 *
 * Slack OAuth callback. Exchanges the auth code for an access token,
 * stores the incoming webhook URL, and redirects the user back to
 * the appropriate page (onboarding or settings).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Verify HMAC-signed state (includes signature check + 10-minute expiry)
  if (!state) {
    console.error('[slack/callback] No state parameter received');
    return NextResponse.redirect(`${APP_URL}/settings?tab=notifications&slack_error=no_state`);
  }

  const parsed = parseSlackOAuthState(state);
  if (!parsed) {
    console.error('[slack/callback] State verification failed');
    return NextResponse.redirect(`${APP_URL}/settings?tab=notifications&slack_error=invalid_state`);
  }

  const { workspaceId, from } = parsed;

  // Resolve workspace UUID → slug for the redirect URL (app routes use slugs, not UUIDs)
  const supabaseForSlug = createServiceClient();
  const { data: wsRow } = await supabaseForSlug
    .from('workspaces')
    .select('slug')
    .eq('id', workspaceId)
    .maybeSingle();
  const workspaceSlug = wsRow?.slug ?? workspaceId;

  const redirectBase =
    from === 'onboarding'
      ? `${APP_URL}/onboarding?step=comms`
      : `${APP_URL}/${workspaceSlug}/settings?tab=notifications`;

  if (error || !code) {
    console.error('[slack/callback] OAuth error from Slack:', error ?? 'no_code');
    return NextResponse.redirect(
      `${redirectBase}&slack_error=${error === 'access_denied' ? 'access_denied' : 'no_code'}`,
    );
  }

  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
    console.error('[slack/callback] Missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET');
    return NextResponse.redirect(`${redirectBase}&slack_error=not_configured`);
  }

  try {
    const callbackUrl = `${APP_URL}/api/notifications/slack/callback`;

    // Exchange code for access token
    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        redirect_uri: callbackUrl,
      }),
    });

    const tokenData: SlackOAuthResponse = await tokenRes.json();

    if (!tokenData.ok) {
      console.error('[slack/callback] OAuth exchange failed:', tokenData.error);
      return NextResponse.redirect(
        `${redirectBase}&slack_error=${tokenData.error ?? 'oauth_failed'}`,
      );
    }

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.redirect(`${redirectBase}&slack_error=auth_required`);
    }

    // Verify user has settings:manage permission on the target workspace
    const supabase = createServiceClient();
    const resolved = await resolvePermissions(supabase, userId, workspaceId);
    if (!resolved.permissions.has('settings:manage')) {
      return NextResponse.redirect(`${redirectBase}&slack_error=insufficient_permissions`);
    }

    // Determine installation type from the response
    const isBotInstall = !!tokenData.access_token && !tokenData.incoming_webhook;

    // Build the upsert payload based on installation type
    const upsertPayload: SlackConnectionUpsert = {
      workspace_id: workspaceId,
      slack_team_id: tokenData.team?.id ?? 'unknown',
      slack_team_name: tokenData.team?.name ?? 'Unknown Workspace',
      connected_by: userId,
      celune_user_id: userId,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    if (isBotInstall && tokenData.access_token) {
      // Bot token install — full multi-tenant Slack app
      const { encryptedKey: botTokenEncrypted, iv: botTokenIv } = encryptProviderKey(
        tokenData.access_token,
      );
      upsertPayload.bot_token_encrypted = botTokenEncrypted;
      upsertPayload.bot_token_iv = botTokenIv;
      upsertPayload.bot_user_id = tokenData.bot_user_id ?? null;
      upsertPayload.app_id = tokenData.app_id ?? null;
      upsertPayload.installed_scopes = tokenData.scope?.split(',') ?? [];
      upsertPayload.installation_type = 'bot';
      upsertPayload.installer_slack_user_id = tokenData.authed_user?.id ?? null;
      // Bot installs don't have incoming_webhook — column is nullable
      upsertPayload.incoming_webhook_url = null;
    } else if (tokenData.incoming_webhook) {
      // Legacy webhook install
      const webhookUrl = tokenData.incoming_webhook.url;
      const { encryptedKey: encryptedWebhookUrl, iv: webhookIv } = encryptProviderKey(webhookUrl);
      upsertPayload.slack_channel = tokenData.incoming_webhook.channel;
      upsertPayload.slack_channel_id = tokenData.incoming_webhook.channel_id;
      upsertPayload.incoming_webhook_url = webhookUrl;
      upsertPayload.encrypted_webhook_url = encryptedWebhookUrl;
      upsertPayload.webhook_iv = webhookIv;
      upsertPayload.installation_type = 'webhook';
    } else {
      console.error('[slack/callback] No token and no webhook in response');
      return NextResponse.redirect(`${redirectBase}&slack_error=invalid_response`);
    }

    const { error: dbError } = await supabase.from('slack_connections').upsert(upsertPayload, {
      onConflict: 'workspace_id,slack_team_id',
    });

    if (dbError) {
      console.error(
        '[slack/callback] DB upsert error:',
        dbError.message,
        dbError.code,
        dbError.details,
      );
      return NextResponse.redirect(`${redirectBase}&slack_error=db_error`);
    }

    console.info('[slack/callback] Slack connected for workspace', workspaceSlug);
    return NextResponse.redirect(`${redirectBase}&slack_connected=true`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[slack/callback] Unexpected error:', message);
    return NextResponse.redirect(`${redirectBase}&slack_error=unexpected`);
  }
}
