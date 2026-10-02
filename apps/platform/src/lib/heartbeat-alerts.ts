/**
 * Heartbeat alert detection and notification.
 *
 * Called by the cron runner to detect stale agents, fire alerts via Slack
 * and activity_log, and reset stale agents to idle.
 */

import type { createServiceClient } from '@repo/db/service';

type SupabaseClient = ReturnType<typeof createServiceClient>;

interface AgentStatusRow {
  agent_name: string;
  status: string;
  last_heartbeat: string | null;
  workspace_id: string;
  current_task_id: string | null;
  model: string | null;
}

interface HeartbeatCheckResult {
  staleAgents: string[];
  alertsFired: number;
  agentsReset: number;
}

/**
 * Checks all agents in a workspace for stale heartbeats and fires alerts.
 *
 * @param supabase - Service client (bypasses RLS)
 * @param workspaceId - Workspace to check
 * @param staleThresholdMs - How long since last heartbeat before an agent is stale (default 90s)
 */
export async function checkWorkspaceHeartbeats(
  supabase: SupabaseClient,
  workspaceId: string,
  staleThresholdMs = 90_000,
): Promise<HeartbeatCheckResult> {
  const result: HeartbeatCheckResult = { staleAgents: [], alertsFired: 0, agentsReset: 0 };

  const { data: agents } = await supabase
    .from('agent_status')
    .select('agent_name, status, last_heartbeat, workspace_id, current_task_id, model')
    .eq('workspace_id', workspaceId);

  if (!agents || agents.length === 0) return result;

  const now = Date.now();
  const stale: AgentStatusRow[] = [];

  for (const agent of agents as AgentStatusRow[]) {
    // Skip agents already offline or idle
    if (agent.status === 'offline' || agent.status === 'idle') continue;

    if (!agent.last_heartbeat) {
      stale.push(agent);
      continue;
    }

    const elapsed = now - new Date(agent.last_heartbeat).getTime();
    if (elapsed > staleThresholdMs) {
      stale.push(agent);
    }
  }

  if (stale.length === 0) return result;

  result.staleAgents = stale.map((a) => a.agent_name);

  // Check dedup: only fire alerts if we haven't alerted for this agent in the last 15 minutes
  const COOLDOWN_MS = 15 * 60 * 1000;
  const cooldownCutoff = new Date(now - COOLDOWN_MS).toISOString();

  for (const agent of stale) {
    // Check for recent alert events for dedup
    const { data: recentAlerts } = await supabase
      .from('heartbeat_events')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('agent_id', agent.agent_name)
      .eq('event_type', 'stale_reset')
      .gte('created_at', cooldownCutoff)
      .limit(1);

    if (recentAlerts && recentAlerts.length > 0) continue; // Already alerted recently

    // Reset agent to idle
    await supabase
      .from('agent_status')
      .update({ status: 'idle', current_task_id: null })
      .eq('workspace_id', workspaceId)
      .eq('agent_name', agent.agent_name);

    result.agentsReset++;

    // Log stale_reset event
    await supabase.from('heartbeat_events').insert({
      workspace_id: workspaceId,
      agent_id: agent.agent_name,
      event_type: 'stale_reset',
      metadata: {
        previous_status: agent.status,
        last_heartbeat: agent.last_heartbeat,
        stale_duration_ms: agent.last_heartbeat
          ? now - new Date(agent.last_heartbeat).getTime()
          : null,
      },
    });

    // Log to activity_log for in-app visibility
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      event_type: 'agent.stale_reset',
      description: `Agent ${agent.agent_name} was reset to idle after missing heartbeats`,
      metadata: {
        agent_id: agent.agent_name,
        previous_status: agent.status,
        last_heartbeat: agent.last_heartbeat,
      },
    });

    result.alertsFired++;
  }

  return result;
}

/**
 * Sends a Slack alert for stale agents using the workspace's Slack connection.
 */
export async function sendSlackHeartbeatAlert(
  supabase: SupabaseClient,
  workspaceId: string,
  staleAgents: string[],
): Promise<boolean> {
  if (staleAgents.length === 0) return false;

  // Look up Slack connection for this workspace
  const { data: slackConn } = await supabase
    .from('slack_connections')
    .select('bot_token, default_channel_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .maybeSingle();

  if (!slackConn?.bot_token || !slackConn?.default_channel_id) return false;

  const agentList = staleAgents.map((a) => `• *${a}*`).join('\n');
  const message =
    staleAgents.length === 1
      ? `⚠️ *Agent Health Alert*\n\nAgent *${staleAgents[0]}* has missed heartbeats and was reset to idle.\n\nCheck the Heartbeat tab in Memory for details.`
      : `⚠️ *Agent Health Alert*\n\n${staleAgents.length} agents have missed heartbeats and were reset to idle:\n\n${agentList}\n\nCheck the Heartbeat tab in Memory for details.`;

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slackConn.bot_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: slackConn.default_channel_id,
        text: message,
      }),
    });

    const data = (await res.json()) as { ok: boolean };
    return data.ok;
  } catch (err) {
    console.error('[heartbeat-alerts] Slack send failed:', err);
    return false;
  }
}
