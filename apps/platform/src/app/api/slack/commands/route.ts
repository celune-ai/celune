import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as crypto from 'node:crypto';
import { createServiceClient } from '@repo/db/service';
import { createActivity } from '@repo/db/queries';

export const dynamic = 'force-dynamic';

// ── Slack HMAC-SHA256 signature verification ─────────────────────────────────

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? '';
const ALLOWED_USER_IDS = (process.env.SLACK_ALLOWED_USER_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

/** Max age of a Slack request before we reject it (replay protection). */
const MAX_REQUEST_AGE_S = 300; // 5 minutes

// ── Rate limiting (in-memory, per-user) ─────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // max commands per window

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return true;
  }

  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

function verifySlackSignature(
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
): { valid: boolean; reason?: string } {
  if (!SLACK_SIGNING_SECRET) {
    return { valid: false, reason: 'SLACK_SIGNING_SECRET not configured' };
  }
  if (!signature || !timestamp) {
    return { valid: false, reason: 'Missing signature or timestamp header' };
  }

  // Replay protection
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_REQUEST_AGE_S) {
    return { valid: false, reason: 'Request too old (replay protection)' };
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const expected =
    'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(sigBasestring).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}

// ── Slack Block Kit helpers ──────────────────────────────────────────────────

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: { type: string; text: string }[];
  fields?: { type: string; text: string }[];
}

function slackMessage(text: string, blocks?: SlackBlock[]) {
  return { response_type: 'ephemeral' as const, text, blocks };
}

function markdownSection(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

// ── Command handlers ─────────────────────────────────────────────────────────

type CommandHandler = (
  args: string,
  userId: string,
) => Promise<{ text: string; blocks?: SlackBlock[] }>;

async function handleStatus(): Promise<{ text: string; blocks?: SlackBlock[] }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('tasks').select('status').neq('status', 'done');

  if (error) {
    console.error('[API Error]', error);
    return { text: 'Error fetching tasks' };
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  const total = data?.length ?? 0;
  const lines = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([status, count]) => `• *${status}*: ${count}`)
    .join('\n');

  return {
    text: `${total} open tasks`,
    blocks: [
      markdownSection(`:clipboard: *Task Status* (${total} open)`),
      markdownSection(lines || '_No open tasks_'),
    ],
  };
}

async function handleAfkToggle(): Promise<{ text: string; blocks?: SlackBlock[] }> {
  const fs = await import('node:fs');
  const sentinel = '/tmp/afk_active';

  let isActive: boolean;
  try {
    if (fs.existsSync(sentinel)) {
      fs.unlinkSync(sentinel);
      isActive = false;
    } else {
      fs.writeFileSync(sentinel, new Date().toISOString());
      isActive = true;
    }
  } catch {
    return { text: 'Error toggling AFK mode' };
  }

  const emoji = isActive ? ':zzz:' : ':wave:';
  const state = isActive ? 'ON' : 'OFF';

  return {
    text: `AFK mode ${state}`,
    blocks: [markdownSection(`${emoji} *AFK mode is now ${state}*`)],
  };
}

async function handleDeploy(): Promise<{ text: string; blocks?: SlackBlock[] }> {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK;
  if (!hookUrl) {
    return { text: 'VERCEL_DEPLOY_HOOK not configured' };
  }

  try {
    const res = await fetch(hookUrl, { method: 'POST' });
    if (!res.ok) {
      return { text: `Deploy trigger failed: ${res.status} ${res.statusText}` };
    }
    return {
      text: 'Deploy triggered',
      blocks: [
        markdownSection(
          ':rocket: *Deploy triggered successfully*\nCheck Vercel dashboard for progress.',
        ),
      ],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { text: `Deploy error: ${msg}` };
  }
}

async function handleHealth(): Promise<{ text: string; blocks?: SlackBlock[] }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3002';
    const res = await fetch(`${baseUrl}/api/health`);
    if (!res.ok) {
      return { text: `Health check failed: ${res.status}` };
    }

    const data = (await res.json()) as {
      status: string;
      checks?: Record<string, { status: string; detail?: string }>;
    };
    const checks = data.checks ?? {};
    const lines = Object.entries(checks)
      .map(([name, check]) => {
        const icon = check.status === 'ok' ? ':white_check_mark:' : ':x:';
        const detail = check.detail ? ` — ${check.detail}` : '';
        return `${icon} *${name}*: ${check.status}${detail}`;
      })
      .join('\n');

    const overallIcon = data.status === 'ok' ? ':green_circle:' : ':red_circle:';

    return {
      text: `Health: ${data.status}`,
      blocks: [
        markdownSection(`${overallIcon} *Integration Health* — ${data.status}`),
        markdownSection(lines || '_No checks available_'),
      ],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { text: `Health check error: ${msg}` };
  }
}

async function handleHelp(): Promise<{ text: string; blocks?: SlackBlock[] }> {
  return {
    text: '/remote commands',
    blocks: [
      markdownSection(':robot_face: */remote* commands'),
      markdownSection(
        [
          '• `status` — Task counts by status',
          '• `health` — Integration health check',
          '• `afk-toggle` — Toggle AFK mode on/off',
          '• `deploy` — Trigger Vercel deploy',
          '• `help` — Show this message',
        ].join('\n'),
      ),
    ],
  };
}

const COMMANDS: Record<string, CommandHandler> = {
  status: handleStatus,
  health: handleHealth,
  'afk-toggle': handleAfkToggle,
  deploy: handleDeploy,
  help: handleHelp,
};

// ── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Read raw body for signature verification
  const rawBody = await request.text();

  // Verify Slack signature
  const sig = request.headers.get('x-slack-signature');
  const ts = request.headers.get('x-slack-request-timestamp');
  const verification = verifySlackSignature(sig, ts, rawBody);

  if (!verification.valid) {
    return NextResponse.json({ error: verification.reason }, { status: 401 });
  }

  // Parse URL-encoded form body
  const params = new URLSearchParams(rawBody);
  const userId = params.get('user_id') ?? '';
  const commandText = (params.get('text') ?? '').trim();
  const channelId = params.get('channel_id') ?? '';

  // User allowlist check — empty list means allow all workspace members
  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(userId)) {
    // Log unauthorized attempt
    try {
      const supabase = createServiceClient();
      await createActivity(supabase, {
        event_type: 'remote.command_denied',
        severity: 'warning',
        source: 'slack-remote',
        title: `Unauthorized /remote attempt by ${userId}`,
        details: { user_id: userId, command: commandText, channel_id: channelId },
      });
    } catch {
      // Non-fatal
    }

    return NextResponse.json(
      slackMessage(':no_entry: You are not authorized to use this command.'),
    );
  }

  // Rate limiting
  if (!checkRateLimit(userId)) {
    return NextResponse.json(
      slackMessage(':hourglass: Too many commands. Please wait a moment and try again.'),
      { status: 429 },
    );
  }

  // Parse subcommand
  const [subcommand, ...argParts] = commandText.split(/\s+/);
  const args = argParts.join(' ');
  const handler = COMMANDS[subcommand || 'help'];

  if (!handler) {
    return NextResponse.json(
      slackMessage(
        `:question: Unknown command \`${subcommand}\`. Try \`/remote help\` for available commands.`,
      ),
    );
  }

  // Execute command
  try {
    const result = await handler(args, userId);

    // Log successful execution
    try {
      const supabase = createServiceClient();
      await createActivity(supabase, {
        event_type: 'remote.command_executed',
        severity: 'info',
        source: 'slack-remote',
        title: `/remote ${subcommand}`,
        details: {
          user_id: userId,
          command: subcommand,
          args: args || undefined,
          channel_id: channelId,
        },
      });
    } catch {
      // Non-fatal — don't fail the command if logging fails
    }

    return NextResponse.json(slackMessage(result.text, result.blocks));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(slackMessage(`:x: Command failed: ${message}`));
  }
}
