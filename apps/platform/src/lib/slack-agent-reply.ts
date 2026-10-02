/**
 * apps/platform/src/lib/slack-agent-reply.ts
 *
 * Agent reply logic for Slack DMs and @mentions. Determines the responding
 * agent, builds context from conversation history, and sends an AI-powered reply.
 *
 * Phase 2: Real AI integration via Anthropic Claude with provider key resolution.
 * Falls back to simple acknowledgment if no API key is available.
 */

import { createServiceClient } from '@repo/db/service';
import { sendAgentMessage, loadConversationContext } from './slack-agent-messaging';
import { resolveProviderKey, ProviderKeyRequiredError } from './resolve-provider-key';
import type { Provider } from './resolve-provider-key';
import { resolveWorkspacePlan } from './plan-enforcement';
import { assistantSetStatus } from './slack-api';

// ── Types ───────────────────────────────────────────────────────────────────

interface AgentReplyOptions {
  workspaceId: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  userMessage: string;
  userId: string;
}

interface AgentConfig {
  agentId: string;
  personality?: string;
  systemPrompt?: string;
  orgId: string;
  /** When true, only use BYOK keys — never fall back to platform key */
  byokOnly?: boolean;
}

// ── Agent resolution ────────────────────────────────────────────────────────

const DEFAULT_AGENT = 'rick';

/**
 * Resolve the lead agent config for this workspace.
 * Returns agent ID, personality, system prompt, and org ID.
 */
async function resolveAgentConfig(workspaceId: string): Promise<AgentConfig> {
  const supabase = createServiceClient();

  // Get workspace org_id for provider key resolution
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('org_id')
    .eq('id', workspaceId)
    .maybeSingle();

  const orgId = workspace?.org_id ?? '';

  // Check for a configured lead agent in agent_configs
  const { data: agent } = await supabase
    .from('agent_configs')
    .select('agent_id, personality_params')
    .eq('workspace_id', workspaceId)
    .eq('is_lead', true)
    .maybeSingle();

  const agentId = agent?.agent_id ?? DEFAULT_AGENT;
  const params =
    typeof agent?.personality_params === 'object' && agent?.personality_params !== null
      ? (agent.personality_params as Record<string, unknown>)
      : {};

  return {
    agentId,
    personality: (params.personality as string) ?? undefined,
    systemPrompt: (params.system_prompt as string) ?? undefined,
    orgId,
  };
}

// ── AI response generation ──────────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant in the Celune workspace platform. You help users with tasks, projects, and workspace management via Slack.

Keep responses concise (2-4 sentences max for simple questions). Use Slack-compatible formatting (bold with *text*, code with \`text\`, links with <url|text>).

If the user asks about tasks or projects, suggest relevant /celune commands. If you don't know the specific answer, be honest and suggest checking the dashboard.`;

/**
 * Generate an AI-powered response using Claude.
 * Falls back to simple acknowledgment if no API key is available.
 */
async function generateAIResponse(
  config: AgentConfig,
  userMessage: string,
  context: { role: string; content: string; agent?: string }[],
): Promise<string> {
  // Try to get an Anthropic API key
  let apiKey: string;
  const provider: Provider = 'anthropic';

  try {
    const resolved = await resolveProviderKey(provider, config.orgId, undefined, {
      skipByokGate: !config.byokOnly, // Builder: require BYOK; Pro+: allow platform key
    });
    apiKey = resolved.key;
  } catch (err) {
    if (err instanceof ProviderKeyRequiredError) {
      return generateFallbackResponse(config.agentId, userMessage);
    }
    // No key available at all — use fallback
    return generateFallbackResponse(config.agentId, userMessage);
  }

  try {
    // Dynamic import to avoid bundling SDK when not needed
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    // Build message history from conversation context
    const messages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const msg of context.slice(-10)) {
      // Keep last 10 messages for context
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // Add the current message
    messages.push({ role: 'user', content: userMessage });

    const systemPrompt =
      config.systemPrompt ??
      `${DEFAULT_SYSTEM_PROMPT}\n\nYou are ${config.agentId.toUpperCase()}${config.personality ? `, with a ${config.personality} personality` : ''}.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages,
    });

    // Extract text from response
    const textBlock = response.content.find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      return textBlock.text;
    }

    return generateFallbackResponse(config.agentId, userMessage);
  } catch (err) {
    console.error('[slack/agent-reply] AI generation failed:', err);
    return generateFallbackResponse(config.agentId, userMessage);
  }
}

/**
 * Fallback response when AI is not available.
 * Simple pattern-matching acknowledgment.
 */
function generateFallbackResponse(agent: string, userMessage: string): string {
  const lower = userMessage.toLowerCase();

  if (lower.includes('help') || lower.includes('what can you do')) {
    return (
      `I'm ${agent.toUpperCase()}, your Celune assistant. I can help with tasks, projects, and your workspace. ` +
      `Try asking about your task status, or use \`/celune\` commands for quick actions.`
    );
  }

  if (lower.includes('status') || lower.includes('task')) {
    return (
      `I'll look into that for you. For a quick task overview, try \`/celune status\` ` +
      `or check your dashboard.`
    );
  }

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return `Hey! I'm ${agent.toUpperCase()}, ready to help with your workspace. What can I do for you?`;
  }

  return (
    `Got it — I'm ${agent.toUpperCase()}. I can help with tasks, projects, and your workspace. ` +
    `Try \`/celune help\` to see available commands, or just ask me a question.`
  );
}

// ── Main handler ────────────────────────────────────────────────────────────

/**
 * Handle an agent reply to a Slack DM or @mention.
 * Called from the events route after storing the user's message.
 */
/**
 * Check if the workspace can use AI-powered Slack replies.
 * Builder: BYOK only (no platform key). Pro: 100/month. Unlimited+: unlimited.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
async function checkSlackAiAccess(
  workspaceId: string,
  userId?: string,
): Promise<{ allowed: boolean; reason?: string; useBYOKOnly?: boolean }> {
  try {
    const { limits } = await resolveWorkspacePlan(workspaceId, userId);
    const hasFeature = limits.features.includes('slack_ai');
    const monthlyLimit = limits.max_slack_ai_messages_per_month;

    // Builder tier: no slack_ai feature — BYOK only
    if (!hasFeature) {
      return { allowed: true, useBYOKOnly: true };
    }

    // Unlimited (null limit) — no cap
    if (monthlyLimit === null) {
      return { allowed: true };
    }

    // Pro tier: check monthly usage
    const supabase = createServiceClient();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { count } = await supabase
      .from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('event_type', 'slack_ai_message')
      .gte('created_at', monthStart.toISOString());

    if ((count ?? 0) >= monthlyLimit) {
      return {
        allowed: false,
        reason: `Monthly Slack AI limit reached (${monthlyLimit} messages). Upgrade to Unlimited for unlimited access, or add your own API key in Settings > Provider Keys.`,
      };
    }

    return { allowed: true };
  } catch (err) {
    // Fail closed — block AI replies if plan enforcement fails (security-first)
    console.error('[slack/agent-reply] Plan check failed, blocking:', err);
    return { allowed: false, reason: 'Unable to verify plan access. Please try again later.' };
  }
}

/** Record a Slack AI message usage event. */
async function trackSlackAiUsage(workspaceId: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from('usage_events').insert({
      workspace_id: workspaceId,
      event_type: 'slack_ai_message',
      quantity: 1,
      unit: 'count',
      metadata: {},
    });
  } catch (err) {
    // Non-fatal — don't block the reply
    console.error('[slack/agent-reply] Failed to track usage:', err);
  }
}

export async function handleAgentReply(opts: AgentReplyOptions): Promise<void> {
  const { workspaceId, channelId, threadTs, userMessage, userId } = opts;

  try {
    // 1. Resolve agent config (includes org_id for provider key)
    const config = await resolveAgentConfig(workspaceId);

    // 1b. Set "thinking" status for assistant sidebar (best effort)
    try {
      const supabase = createServiceClient();
      const { data: conn } = await supabase
        .from('slack_connections')
        .select('bot_token_encrypted, bot_token_iv, installation_type')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .maybeSingle();
      if (conn) {
        const { decryptBotToken: decrypt } = await import('@repo/notifications/decrypt-webhook');
        const botToken = decrypt(conn as Parameters<typeof decrypt>[0]);
        if (botToken) {
          await assistantSetStatus(
            botToken,
            channelId,
            threadTs,
            `${config.agentId.toUpperCase()} is thinking...`,
          );
        }
      }
    } catch {
      // Non-fatal — status is cosmetic
    }

    // 2. Resolve Celune user ID from workspace membership for plan enforcement
    let celuneUserId: string | undefined;
    try {
      const supabaseForUser = createServiceClient();
      const { data: membership } = await supabaseForUser
        .from('workspace_memberships')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .limit(1)
        .maybeSingle();
      celuneUserId = membership?.user_id ?? undefined;
    } catch {
      // Non-fatal — checkSlackAiAccess will work without userId, just skip platform owner check
    }

    // 3. Check plan-based Slack AI access
    const access = await checkSlackAiAccess(workspaceId, celuneUserId);

    let responseText: string;

    if (!access.allowed) {
      // Over monthly limit — send limit message instead of AI reply
      responseText = access.reason ?? 'Slack AI message limit reached for this month.';
    } else if (access.useBYOKOnly) {
      // Builder tier: only use BYOK key, never platform key
      const context = await loadConversationContext(workspaceId, threadTs);
      responseText = await generateAIResponse({ ...config, byokOnly: true }, userMessage, context);
    } else {
      // Pro/Unlimited: full AI access
      const context = await loadConversationContext(workspaceId, threadTs);
      responseText = await generateAIResponse(config, userMessage, context);
      // Track usage for metered plans
      await trackSlackAiUsage(workspaceId);
    }

    // 4. Send the reply via the agent messaging service
    const result = await sendAgentMessage({
      workspaceId,
      channel: channelId,
      text: responseText,
      threadTs,
      agent: config.agentId,
    });

    if (!result.success) {
      console.error(`[slack/agent-reply] Failed to send reply:`, result.error);
    } else {
      console.debug(
        `[slack/agent-reply] ${config.agentId} replied in ${channelId} (thread: ${threadTs})`,
      );
    }
  } catch (err) {
    // Non-fatal — log but don't throw. The user's message is already stored.
    console.error(`[slack/agent-reply] Error generating reply:`, err);
  }
}
