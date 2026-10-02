/**
 * GET /api/discord/install
 *
 * Generates the Discord OAuth2 authorization URL and redirects the user.
 * Includes bot + applications.commands scopes so the bot is installed with
 * slash command support.
 *
 * Query params:
 *   - workspace_id: Celune workspace to link (required)
 *   - user_id: Celune user initiating the install (required)
 *   - guild_id: pre-select a Discord server (optional)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { generateDiscordOAuthState } from '@/lib/oauth-state';
import { APP_URL } from '@/lib/branding';

export const dynamic = 'force-dynamic';

const CLIENT_ID = () => process.env.DISCORD_APPLICATION_ID!;

// Bot permissions: Send Messages, Embed Links, Use Slash Commands, Read Message History
const BOT_PERMISSIONS = '2147485696';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspace_id');
  const guildId = searchParams.get('guild_id');

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }

  // ── Auth: verify user is authenticated and is a member of the workspace ──
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = createServiceClient();
  const { data: member } = await svc
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // HMAC-signed state with 10-minute expiry (matches GitHub/Slack OAuth pattern)
  const state = generateDiscordOAuthState(workspaceId, user.id);

  const params = new URLSearchParams({
    client_id: CLIENT_ID(),
    redirect_uri: `${APP_URL}/api/discord/oauth/callback`,
    response_type: 'code',
    scope: 'bot applications.commands identify',
    permissions: BOT_PERMISSIONS,
    state,
  });

  if (guildId) {
    params.set('guild_id', guildId);
    params.set('disable_guild_select', 'true');
  }

  return NextResponse.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
}
