/**
 * GET /api/discord/oauth/callback
 *
 * Discord OAuth2 callback — exchanges the authorization code for tokens,
 * resolves the Discord user, and stores/updates the discord_connections row.
 *
 * Query params from Discord:
 *   - code: authorization code
 *   - guild_id: the guild the bot was added to
 *   - state: JSON-encoded { workspace_id, user_id } (set during install redirect)
 *
 * On success: redirects to /settings?discord=connected
 * On error:   redirects to /settings?discord=error&reason=<msg>
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { parseDiscordOAuthState } from '@/lib/oauth-state';
import { APP_URL } from '@/lib/branding';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';
const CLIENT_ID = () => process.env.DISCORD_APPLICATION_ID!;
const CLIENT_SECRET = () => process.env.DISCORD_CLIENT_SECRET!;

function settingsRedirect(workspaceSlug: string | null, params: Record<string, string>) {
  const base = workspaceSlug ? `${APP_URL}/${workspaceSlug}/settings` : `${APP_URL}/settings`;
  const qs = new URLSearchParams(params).toString();
  return NextResponse.redirect(`${base}?${qs}`);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const guildId = searchParams.get('guild_id');
  const stateRaw = searchParams.get('state');

  // Parse and verify HMAC-signed state
  if (!stateRaw) {
    return settingsRedirect(null, { discord: 'error', reason: 'missing_state' });
  }

  const state = parseDiscordOAuthState(stateRaw);
  if (!state) {
    return settingsRedirect(null, { discord: 'error', reason: 'invalid_or_expired_state' });
  }

  if (!code) {
    return settingsRedirect(null, { discord: 'error', reason: 'missing_code' });
  }

  // ── Exchange code for access token ──────────────────────────────────────

  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${APP_URL}/api/discord/oauth/callback`,
    }),
  });

  if (!tokenRes.ok) {
    console.error('[discord-oauth] Token exchange failed:', tokenRes.status, await tokenRes.text());
    return settingsRedirect(null, { discord: 'error', reason: 'token_exchange_failed' });
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    token_type: string;
    guild?: { id: string };
  };

  // ── Fetch Discord user info ─────────────────────────────────────────────

  const userRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    console.error('[discord-oauth] User fetch failed:', userRes.status);
    return settingsRedirect(null, { discord: 'error', reason: 'user_fetch_failed' });
  }

  const discordUser = (await userRes.json()) as {
    id: string;
    username: string;
    global_name?: string;
  };

  const resolvedGuildId = guildId ?? tokenData.guild?.id ?? null;

  // ── Store/update discord_connections ─────────────────────────────────────

  const supabase = createServiceClient();

  // Look up workspace slug for redirect
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('slug')
    .eq('id', state.workspaceId)
    .single();

  // Upsert the connection (unique on discord_user_id + workspace_id)
  const { error } = await supabase.from('discord_connections').upsert(
    {
      discord_user_id: discordUser.id,
      discord_username: discordUser.global_name ?? discordUser.username,
      workspace_id: state.workspaceId,
      user_id: state.userId,
      guild_id: resolvedGuildId,
      is_active: true,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'discord_user_id,workspace_id' },
  );

  if (error) {
    console.error('[discord-oauth] Upsert failed:', error);
    return settingsRedirect(workspace?.slug ?? null, {
      discord: 'error',
      reason: 'db_error',
    });
  }

  return settingsRedirect(workspace?.slug ?? null, { discord: 'connected' });
}
