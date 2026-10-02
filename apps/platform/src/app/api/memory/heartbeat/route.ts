/**
 * GET /api/memory/heartbeat
 *
 * Powers the Heartbeat tab on the memory page. Returns agent status,
 * recent heartbeat events, and aggregate metrics for a workspace.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

export const GET = withApiSecurity(
  async (request: NextRequest, { userId }: SecurityContext) => {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Fetch agent statuses
    const { data: agents } = await supabase
      .from('agent_status')
      .select('agent_name, status, last_heartbeat, current_task_id, model, metadata')
      .eq('workspace_id', workspaceId);

    // Fetch recent heartbeat events (last 50)
    const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
    const limit = 50;
    const { data: events } = await supabase
      .from('heartbeat_events')
      .select('id, agent_id, event_type, metadata, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range(page * limit, (page + 1) * limit - 1);

    // Compute aggregate metrics from today's events
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayEvents } = await supabase
      .from('heartbeat_events')
      .select('event_type, agent_id, created_at')
      .eq('workspace_id', workspaceId)
      .gte('created_at', todayStart.toISOString());

    const sessionsToday = (todayEvents ?? []).filter((e) => e.event_type === 'task_started').length;
    const staleResetsToday = (todayEvents ?? []).filter(
      (e) => e.event_type === 'stale_reset',
    ).length;

    // Calculate uptime percentage (agents online or working vs total time)
    const totalAgents = (agents ?? []).length;
    const activeAgents = (agents ?? []).filter(
      (a) => a.status === 'online' || a.status === 'working',
    ).length;
    const uptimePct = totalAgents > 0 ? Math.round((activeAgents / totalAgents) * 100) : 0;

    // Get agent display names from agent_configs for richer UI
    const { data: agentConfigs } = await supabase
      .from('agent_configs')
      .select('agent_id, display_name, color, role')
      .eq('workspace_id', workspaceId);

    const configMap = new Map((agentConfigs ?? []).map((c) => [c.agent_id, c]));

    const enrichedAgents = (agents ?? []).map((a) => {
      const config = configMap.get(a.agent_name);
      return {
        ...a,
        display_name: config?.display_name ?? a.agent_name,
        color: config?.color ?? '#71717A',
        role: config?.role ?? 'Agent',
      };
    });

    return NextResponse.json({
      agents: enrichedAgents,
      events: events ?? [],
      metrics: {
        total_sessions_today: sessionsToday,
        stale_resets_today: staleResetsToday,
        uptime_pct: uptimePct,
        total_agents: totalAgents,
        active_agents: activeAgents,
      },
      page,
      has_more: (events ?? []).length === limit,
    });
  },
  {
    rateLimit: { tier: RATE_READ, routeKey: 'memory.heartbeat.get' },
    csrf: false,
  },
);
