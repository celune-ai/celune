/**
 * /api/discord/channels
 *
 * Manage channel-agent assignments for Discord integration.
 * Stores mappings in workspace settings under `discord_channel_agents`.
 *
 * GET  — list channel-agent mappings for the authenticated user's workspace
 * PUT  — assign an agent to a Discord channel (or remove assignment)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@repo/db/service';

export const dynamic = 'force-dynamic';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChannelAgentMapping {
  channel_id: string;
  agent_id: string | null;
  channel_name?: string;
}

// ── Auth Helper ────────────────────────────────────────────────────────────

async function resolveWorkspace(
  request: NextRequest,
): Promise<{ workspaceId: string; userId: string } | null> {
  const supabase = createServiceClient();

  // Get workspace_id from query param or header
  const workspaceId =
    request.nextUrl.searchParams.get('workspace_id') ?? request.headers.get('x-workspace-id');

  if (!workspaceId) return null;

  // Verify the user has access to this workspace via auth header
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return null;

  // Check workspace membership
  const { data: member } = await supabase
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member) return null;

  return { workspaceId, userId: user.id };
}

// ── GET — List channel-agent mappings ──────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await resolveWorkspace(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('settings')
    .eq('id', auth.workspaceId)
    .single();

  const settings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const channelAgents = (settings.discord_channel_agents ?? {}) as Record<string, string>;

  // Convert to array format for the client
  const mappings: ChannelAgentMapping[] = Object.entries(channelAgents).map(
    ([channelId, agentId]) => ({
      channel_id: channelId,
      agent_id: agentId,
    }),
  );

  return NextResponse.json({ mappings });
}

// ── PUT — Assign agent to channel ──────────────────────────────────────────

export async function PUT(request: NextRequest) {
  const auth = await resolveWorkspace(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const channelAssignSchema = z.object({
    channel_id: z.string().min(1),
    agent_id: z.string().nullable(),
    channel_name: z.string().optional(),
  });

  let body: z.infer<typeof channelAssignSchema>;
  try {
    const raw = await request.json();
    const parsed = channelAssignSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'channel_id is required' }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { channel_id, agent_id } = body;

  // If agent_id is provided, verify it belongs to this workspace
  if (agent_id) {
    const supabase = createServiceClient();
    const { data: agent } = await supabase
      .from('agent_configs')
      .select('id')
      .eq('id', agent_id)
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle();

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found in workspace' }, { status: 404 });
    }
  }

  const supabase = createServiceClient();

  // Get current settings
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('settings')
    .eq('id', auth.workspaceId)
    .single();

  const settings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const channelAgents = { ...((settings.discord_channel_agents ?? {}) as Record<string, string>) };

  // Update or remove the mapping
  if (agent_id) {
    channelAgents[channel_id] = agent_id;
  } else {
    delete channelAgents[channel_id];
  }

  // Save back to workspace settings
  const { error } = await supabase
    .from('workspaces')
    .update({
      settings: { ...settings, discord_channel_agents: channelAgents },
    })
    .eq('id', auth.workspaceId);

  if (error) {
    console.error('[discord-channels] Failed to update settings:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    mapping: { channel_id, agent_id },
  });
}
