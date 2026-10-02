import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePlatformOwner } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';
import {
  getAgentMailClient,
  AGENT_MAIL_DOMAIN,
  agentDisplayName,
  extractInboxEmail,
} from '@/lib/agentmail';
import { createClient } from '@repo/db/server';
import { validateOrigin } from '@/lib/csrf';
import { agentmailProvisionSchema } from '@/lib/schemas/agentmail.schema';

import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/** GET /api/agentmail/inboxes — List all provisioned inboxes */
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await applyRateLimit(request, 'agentmail.inboxes.get', RATE_READ);
    if (rateLimitResult) return rateLimitResult.blocked;

    const permResult = await requirePlatformOwner(request);
    if (permResult instanceof NextResponse) return permResult;

    const client = getAgentMailClient();
    const response = await client.inboxes.list();
    return NextResponse.json({ inboxes: response.inboxes ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/** POST /api/agentmail/inboxes — Provision inboxes for workspace agents */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'agentmail.inboxes.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const permResult = await requirePlatformOwner(request);
    if (permResult instanceof NextResponse) return permResult;

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = agentmailProvisionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const workspaceId = parsed.data.workspace_id;

    // Service client: fetches agent configs. Accesses: agent_configs.
    const supabase = await createClient();
    const { data: agents, error: agentsError } = await supabase
      .from('agent_configs')
      .select('agent_id, display_name')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if (agentsError) throw agentsError;
    if (!agents || agents.length === 0) {
      return NextResponse.json({ error: 'No agents found in workspace' }, { status: 404 });
    }

    const client = getAgentMailClient();

    // Fetch existing inboxes to avoid duplicates
    const existing = await client.inboxes.list();
    const existingEmails = new Set(
      (existing.inboxes ?? []).map((inbox) => extractInboxEmail(inbox.displayName)?.toLowerCase()),
    );

    const created: Array<{ agent_id: string; email: string; inbox_id: string }> = [];
    const skipped: Array<{ agent_id: string; email: string; reason: string }> = [];

    for (const agent of agents) {
      const email = `${agent.agent_id}@${AGENT_MAIL_DOMAIN}`;

      if (existingEmails.has(email.toLowerCase())) {
        skipped.push({ agent_id: agent.agent_id, email, reason: 'already exists' });
        continue;
      }

      try {
        const name = agent.display_name ?? agentDisplayName(agent.agent_id);
        const inbox = await client.inboxes.create({
          username: agent.agent_id,
          domain: AGENT_MAIL_DOMAIN,
          displayName: `${name} <${email}>`,
        });
        created.push({
          agent_id: agent.agent_id,
          email,
          inbox_id: inbox.inboxId ?? 'unknown',
        });
      } catch (err) {
        skipped.push({
          agent_id: agent.agent_id,
          email,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({ created, skipped }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
