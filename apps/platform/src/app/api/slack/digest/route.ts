/**
 * POST /api/slack/digest?type=daily|weekly
 *
 * Cron-triggered endpoint that generates and sends digests to all
 * Slack-connected workspaces with digest notifications enabled.
 *
 * Protected by CRON_SECRET header or service key.
 */

import crypto from 'crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { decryptBotToken } from '@repo/notifications/decrypt-webhook';
import type { BotTokenFields } from '@repo/notifications/decrypt-webhook';
import { chatPostMessage } from '@/lib/slack-api';
import { generateDailyDigest, generateWeeklyDigest } from '@/lib/slack-digests';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60s for processing all workspaces

// ── Auth ────────────────────────────────────────────────────────────────────

function timingSafeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const providedToken = authHeader.slice(7); // Remove 'Bearer '

  // Check CRON_SECRET header (Vercel Cron)
  const cronSecret = process.env['CRON_SECRET'];
  if (cronSecret && timingSafeCompare(providedToken, cronSecret)) return true;

  // Check service key as fallback
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (serviceKey && timingSafeCompare(providedToken, serviceKey)) return true;

  return false;
}

// ── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const digestType = request.nextUrl.searchParams.get('type');
  if (digestType !== 'daily' && digestType !== 'weekly') {
    return NextResponse.json(
      { error: 'Query param "type" must be "daily" or "weekly"' },
      { status: 400 },
    );
  }

  const frequencyFilter = digestType === 'daily' ? 'digest_daily' : 'digest_weekly';

  const supabase = createServiceClient();

  // Find all active Slack connections
  const { data: connections } = await supabase
    .from('slack_connections')
    .select('workspace_id, bot_token_encrypted, bot_token_iv, installation_type, slack_channel_id')
    .eq('is_active', true);

  if (!connections || connections.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No active Slack connections' });
  }

  let sent = 0;
  const errors: string[] = [];

  for (const conn of connections) {
    try {
      const workspaceId = conn.workspace_id;

      // Check if this workspace has digest notifications enabled
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('frequency, is_enabled, slack_channel')
        .eq('workspace_id', workspaceId)
        .eq('channel', 'slack')
        .eq('is_enabled', true)
        .eq('frequency', frequencyFilter)
        .limit(1)
        .maybeSingle();

      // Skip workspaces without matching digest preference
      if (!prefs) continue;

      const botToken = decryptBotToken(conn as BotTokenFields);
      if (!botToken) {
        errors.push(`No bot token for workspace ${workspaceId}`);
        continue;
      }

      // Determine target channel: preference override > connection default
      const targetChannel = prefs.slack_channel ?? conn.slack_channel_id;
      if (!targetChannel) {
        errors.push(`No channel configured for workspace ${workspaceId}`);
        continue;
      }

      // Generate digest blocks
      const blocks =
        digestType === 'daily'
          ? await generateDailyDigest(workspaceId)
          : await generateWeeklyDigest(workspaceId);

      // Post digest
      const fallbackText = `Your ${digestType} Celune digest is ready.`;
      await chatPostMessage(botToken, targetChannel, fallbackText, { blocks });
      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Workspace ${conn.workspace_id}: ${msg}`);
      console.error(`[slack/digest] Error for workspace ${conn.workspace_id}:`, err);
    }
  }

  return NextResponse.json({
    sent,
    total: connections.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
