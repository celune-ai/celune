import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { createActivity } from '@repo/db/queries';
import { safeErrorResponse } from '@/lib/api-error';
import { hookNotifySchema } from '@/lib/schemas/hooks.schema';

export const dynamic = 'force-dynamic';

/**
 * Webhook receiver for Claude Code hook events.
 *
 * Shell hooks (PreToolUse, PostToolUse, SessionStart, etc.) POST here so the
 * admin dashboard gets real-time agent activity without needing browser CSRF
 * headers. Auth is a shared secret via the X-Hook-Secret header.
 *
 * Body shape:
 *   {
 *     event:    string   — hook event name (e.g. "session.start", "tool.bash", "dep.denied")
 *     severity: string   — "info" | "warning" | "error"
 *     source:   string   — agent id or script name (e.g. "rick", "verify-deps")
 *     title:    string   — short human-readable summary
 *     details?: object   — optional metadata object (or omit)
 *     task_id?: string   — UUID of related Supabase task (optional)
 *     agent_id?: string  — agent name for filtering (optional, defaults to source)
 *   }
 */
export async function POST(request: NextRequest) {
  // Auth: shared secret header
  const secret = request.headers.get('x-hook-secret');
  const expected = process.env.HOOK_SECRET;

  if (!expected) {
    return NextResponse.json({ error: 'Hook endpoint not configured' }, { status: 501 });
  }
  if (
    !secret ||
    secret.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = hookNotifySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const { event, severity, source, title, details, task_id, agent_id } = parsed.data;

  const resolvedSeverity = severity ?? 'info';
  const resolvedSource = source || 'claude-hook';
  const resolvedAgentId = agent_id || resolvedSource;
  const resolvedTaskId = task_id ?? undefined;
  // details can be a plain object or a string message; normalize to Record<string, unknown>
  const resolvedDetails: Record<string, unknown> | undefined =
    details && typeof details === 'object'
      ? (details as Record<string, unknown>)
      : typeof details === 'string' && details
        ? { message: details }
        : undefined;

  try {
    const supabase = createServiceClient();
    const activity = await createActivity(supabase, {
      event_type: event,
      severity: resolvedSeverity,
      source: resolvedSource,
      title,
      details: resolvedDetails,
      task_id: resolvedTaskId,
      agent_id: resolvedAgentId,
    });

    return NextResponse.json({ ok: true, id: activity.id }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
