/**
 * POST /api/discord/gateway-events
 *
 * Receives events forwarded from the standalone Discord Gateway process.
 * Validates a shared secret, then dispatches to memory ingestion and
 * proactive response handlers.
 *
 * Returns 200 immediately — heavy processing runs in the background.
 */

import crypto from 'crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@repo/db/service';
import { ingestWithSummarization, accumulateMessage } from '@/lib/discord-memory-ingest';
import {
  shouldRespond,
  generateProactiveResponse,
  buildProactiveContext,
  sendThreadedReply,
} from '@/lib/discord-proactive';
import { filterMessage, logRateLimitHit } from '@/lib/discord-relevance-filter';
import { createFollowupMessage } from '@/lib/discord-api';
import type { GatewayMessage } from '@/lib/discord-gateway';

export const dynamic = 'force-dynamic';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const BOT_TOKEN = () => process.env.DISCORD_BOT_TOKEN;

// ── Auth ───────────────────────────────────────────────────────────────────

function validateSecret(request: NextRequest): boolean {
  const secret = process.env.DISCORD_GATEWAY_SECRET;
  if (!secret) {
    console.error('[gateway-events] DISCORD_GATEWAY_SECRET not configured');
    return false;
  }

  const provided = request.headers.get('x-gateway-secret');
  if (!provided) return false;

  const expectedBuf = Buffer.from(secret, 'utf-8');
  const providedBuf = Buffer.from(provided, 'utf-8');

  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// ── Discord REST — send message to channel ─────────────────────────────────

async function sendChannelMessage(channelId: string, content: string): Promise<void> {
  const token = BOT_TOKEN();
  if (!token) return;

  await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
}

// ── Workspace Resolution ───────────────────────────────────────────────────

async function resolveWorkspaceForGuild(guildId: string): Promise<string | null> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('discord_connections')
    .select('workspace_id')
    .eq('discord_guild_id', guildId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  return data?.workspace_id ?? null;
}

// ── Route Handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Validate shared secret
  if (!validateSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gatewayEventSchema = z.object({
    event: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  });

  let body: z.infer<typeof gatewayEventSchema>;
  try {
    const raw = await request.json();
    const parsed = gatewayEventSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { event, data } = body;

  // Return 200 immediately — process in background
  const response = NextResponse.json({ ok: true });

  if (event === 'MESSAGE_CREATE') {
    const message = data as unknown as GatewayMessage;

    // Skip bot messages early
    if (message.author.bot) return response;

    // Resolve guild → workspace
    if (!message.guild_id) return response;

    (async () => {
      try {
        const workspaceId = await resolveWorkspaceForGuild(message.guild_id!);
        if (!workspaceId) return;

        // v2: Run relevance filter first
        const relevance = await filterMessage(message, workspaceId);
        if (!relevance.relevant) {
          // Accumulate for batch processing even if not individually relevant
          accumulateMessage(message, workspaceId);
          return;
        }

        // Run memory ingestion (with summarization) and proactive response check in parallel
        const [ingestResult, respondResult] = await Promise.all([
          ingestWithSummarization(message, workspaceId),
          shouldRespond(message, workspaceId),
        ]);

        if (ingestResult.stored) {
          console.info(
            `[gateway-events] Stored message ${message.id} as memory ${ingestResult.memoryId} (${ingestResult.classification ?? 'raw'})`,
          );
        }

        // Generate and send proactive response if triggered (v2: threaded reply)
        if (respondResult.respond) {
          const context = await buildProactiveContext(message, workspaceId, respondResult.triggers);

          if (context) {
            const reply = await generateProactiveResponse(message, context);
            if (reply) {
              // v2: Send as threaded reply instead of top-level message
              const sent = await sendThreadedReply(message.channel_id, message.id, reply);
              if (!sent) {
                // Fallback to top-level message if thread reply fails
                await sendChannelMessage(message.channel_id, reply);
              }
              console.info(
                `[gateway-events] Sent proactive response in channel ${message.channel_id}`,
              );
            }
          }
        }
      } catch (err) {
        console.error('[gateway-events] Background processing error:', err);
      }
    })();
  }

  return response;
}
