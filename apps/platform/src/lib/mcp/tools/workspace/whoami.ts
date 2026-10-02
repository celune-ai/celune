import { z } from 'zod';
import type { McpToolHandler } from '../../types';
import { textResult } from '../../types';

export const whoami: McpToolHandler = {
  name: 'whoami',
  description:
    'IMPORTANT: Call this tool FIRST before doing anything else. Returns your identity, workspace context, onboarding status, available workspaces, and instructions for what to do next. If the user is still onboarding, the response will tell you exactly which tools to use to continue the conversation from this IDE.',
  schema: z.object({}),
  scope: 'public',
  group: 'workspace',
  async execute(_params, { auth, supabase }) {
    const { workspaceId, userId, orgId } = auth;

    const [{ data: workspace }, { data: user }, { data: wsData }] = await Promise.all([
      supabase.from('workspaces').select('name, slug, metadata').eq('id', workspaceId).single(),
      supabase
        .from('auth.users' as 'workspaces')
        .select('email')
        .eq('id', userId)
        .single(),
      supabase.from('workspaces').select('metadata').eq('id', workspaceId).single(),
    ]);

    // Fetch all workspaces the user has access to
    const { data: directMemberships } = await supabase
      .from('workspace_memberships')
      .select('workspace_id, workspaces(id, name, slug, is_default)')
      .eq('user_id', userId);

    // Also check org-level access (owner/admin sees all org workspaces)
    let orgWorkspaces: Array<{ id: string; name: string; slug: string; is_default: boolean }> = [];
    if (orgId) {
      const { data: orgMember } = await supabase
        .from('org_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('org_id', orgId)
        .single();
      if (orgMember?.role === 'owner' || orgMember?.role === 'admin') {
        const { data: allOrgWs } = await supabase
          .from('workspaces')
          .select('id, name, slug, is_default')
          .eq('org_id', orgId);
        orgWorkspaces = (allOrgWs ?? []) as typeof orgWorkspaces;
      }
    }

    // Merge direct + org workspaces, deduplicate by id
    const wsMap = new Map<
      string,
      { id: string; name: string; slug: string; is_default: boolean }
    >();
    for (const m of directMemberships ?? []) {
      const ws = m.workspaces as unknown as {
        id: string;
        name: string;
        slug: string;
        is_default: boolean;
      } | null;
      if (ws) wsMap.set(ws.id, ws);
    }
    for (const ws of orgWorkspaces) {
      if (!wsMap.has(ws.id)) wsMap.set(ws.id, ws);
    }
    const availableWorkspaces = Array.from(wsMap.values()).map((ws) => ({
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      is_default: ws.is_default,
      is_current: ws.id === workspaceId,
    }));

    const { data: agentConfig } = await supabase
      .from('agent_configs')
      .select('display_name')
      .eq('workspace_id', workspaceId)
      .eq('agent_id', 'rick')
      .maybeSingle();
    const agentLeadName = agentConfig?.display_name || 'RICK';

    const metadata = (wsData?.metadata ?? workspace?.metadata) as Record<string, unknown> | null;
    const brainConfig = metadata?.brain_config as Record<string, unknown> | null;
    const onboardingComplete = !!brainConfig?.bootstrap_completed_at;

    const { data: onboardingMemory } = await supabase
      .from('agent_memory')
      .select('key')
      .eq('workspace_id', workspaceId)
      .in('key', ['onboarding-complete', 'onboarding:onboarding-complete'])
      .maybeSingle();
    const conversationComplete = !!onboardingMemory;

    let statusMessage: string;
    if (conversationComplete) {
      statusMessage = [
        `✦ Celune Connected. ${agentLeadName} reporting.`,
        '',
        'Your second brain is live. Memories, tasks, and projects are all accessible from this editor.',
        "Use recall_memory to search your knowledge, store_memory to save context, and list_tasks to see what's on deck.",
        `${agentLeadName} is ready to work.`,
      ].join('\n');
    } else if (onboardingComplete) {
      statusMessage = [
        `✦ Celune Connected. ${agentLeadName} reporting.`,
        '',
        `Onboarding is in progress. ${agentLeadName} has some questions to finish setting up the user's second brain.`,
        '',
        '**ACTION REQUIRED:** The user can answer onboarding questions right here in the IDE — no need to switch to the browser.',
        '- Use `get_onboarding_conversation` to see what has been discussed so far.',
        '- Use `send_onboarding_message` to send responses. Messages sync in real-time to the web dashboard.',
        '',
        'If the user says anything conversational (about themselves, their work, their goals), route it through `send_onboarding_message` so it gets captured as part of onboarding.',
      ].join('\n');
    } else {
      statusMessage = [
        `✦ Celune Connected. ${agentLeadName} reporting.`,
        '',
        "The IDE is linked but onboarding hasn't started yet.",
        '',
        '**ACTION REQUIRED:** The user can start and complete onboarding right here in the IDE.',
        '- Use `send_onboarding_message` to begin the onboarding conversation. The first message will kick things off.',
        '- Messages sync in real-time to the Celune web dashboard.',
        '',
        'If the user says anything conversational (about themselves, their work, their goals), route it through `send_onboarding_message` so it gets captured.',
      ].join('\n');
    }

    return {
      content: [
        { type: 'text' as const, text: statusMessage },
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              user_id: userId,
              email: (user as Record<string, string> | null)?.email ?? 'unknown',
              workspace: workspace?.name ?? 'unknown',
              workspace_slug: workspace?.slug ?? 'unknown',
              workspace_id: workspaceId,
              org_id: orgId,
              scopes: auth.scopes,
              environment: auth.environment,
              agent_lead: agentLeadName,
              onboarding_complete: conversationComplete,
              second_brain_active: conversationComplete,
              realtime_enabled: auth.realtimeEnabled,
              stream_url: auth.realtimeEnabled ? '/api/mcp/stream' : null,
              available_workspaces: availableWorkspaces,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};
