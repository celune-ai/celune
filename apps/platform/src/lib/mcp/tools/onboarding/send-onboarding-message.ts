import { z } from 'zod';
import type { McpToolHandler } from '../../types';
import { textResult } from '../../types';
import {
  workspaceOverrideSchema,
  resolveWorkspace,
  isResolveError,
} from '../../workspace-resolver';

export const sendOnboardingMessage: McpToolHandler = {
  name: 'send_onboarding_message',
  description:
    "Send a message in the onboarding conversation. The onboarding agent will respond, and the full exchange syncs to the web dashboard in real-time. Use this whenever the user shares information about themselves, their work, goals, or preferences during onboarding. Route conversational messages through this tool — don't answer onboarding questions yourself.",
  schema: z.object({
    ...workspaceOverrideSchema,
    message: z.string().min(1).max(4000).describe('Your message to the onboarding agent'),
  }),
  scope: 'write',
  group: 'onboarding',
  async execute(params, { auth, supabase }) {
    const resolved = await resolveWorkspace(params, auth, supabase);
    if (isResolveError(resolved)) return resolved;

    // Dynamically import Anthropic to avoid top-level dep
    const { default: Anthropic } = await import('@anthropic-ai/sdk');

    const { workspaceId, orgId } = resolved;
    const { userId } = auth;

    // Find or create conversation
    let { data: conversation } = await supabase
      .from('conversation_logs')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('source', 'onboarding')
      .eq('status', 'active')
      .maybeSingle();

    if (!conversation) {
      const { data: created } = await supabase
        .from('conversation_logs')
        .insert({
          workspace_id: workspaceId,
          user_id: userId,
          source: 'onboarding',
          title: 'Onboarding conversation',
          status: 'active',
        })
        .select('id')
        .single();
      conversation = created;
    }

    if (!conversation) {
      return textResult('Failed to create conversation.');
    }

    const convId = conversation.id;

    // Insert user message
    await supabase.from('conversation_messages').insert({
      conversation_id: convId,
      role: 'user',
      content: params.message as string,
      metadata: { source_channel: 'mcp' },
    });

    // Load full conversation history for AI context
    const { data: allMessages } = await supabase
      .from('conversation_messages')
      .select('role, content')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiMessages = (allMessages ?? []).map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Resolve API key
    let apiKey: string | undefined;
    if (orgId) {
      try {
        const { resolveProviderKey } = await import('@/lib/resolve-provider-key');
        const resolved = await resolveProviderKey('anthropic', orgId, workspaceId, { userId });
        apiKey = resolved.key;
      } catch (err) {
        const { ProviderKeyRequiredError } = await import('@/lib/resolve-provider-key');
        if (err instanceof ProviderKeyRequiredError) {
          return textResult(err.message);
        }
      }
    }
    if (!apiKey) {
      return textResult('No Anthropic API key configured.');
    }

    const ONBOARDING_SYSTEM_PROMPT = `You are the user's Lead Agent — their personal AI teammate. Celune is the platform you both work on, but you are NOT Celune itself. You're more like a smart colleague who happens to live inside Celune. Never say "I'm Celune" or identify yourself as the platform. This is your very first conversation with your user — they just signed up and you're getting to know them.

## Your Goal
Have a natural, warm conversation to deeply understand this person. You need to learn:
1. **Who they are** — their role, company/project, team size, experience level
2. **What they're building** — current projects, goals, challenges, tech stack
3. **How they work** — preferred workflows, tools they use, communication style
4. **What they need help with** — pain points, what they wish they had, where they spend too much time
5. **Their working style** — autonomy preference, decision-making approach, how they like feedback

## Conversation Style
- Be genuinely curious and engaged. This isn't an interview — it's a real conversation.
- Ask one question at a time. Follow up on interesting threads before moving on.
- Keep responses to 2-4 sentences. Don't lecture.
- Be warm but professional. Think "smart colleague at a coffee shop."
- After 8-12 exchanges, naturally wind down.

## Memory Extraction
After EVERY response you give, emit a memory block on a new line with the format:
[MEMORY:category:key:content]
Categories: preference, decision, context, fact

## Ending
When the conversation feels complete (usually 8-12 exchanges), emit: [MEMORY:context:onboarding-complete:true]`;

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: ONBOARDING_SYSTEM_PROMPT,
      messages: aiMessages,
    });

    const assistantText =
      response.content
        .filter((b) => b.type === 'text')
        .map((b) => ('text' in b ? (b as { text: string }).text : ''))
        .join('') || '';

    // Insert assistant response
    await supabase.from('conversation_messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: assistantText,
      metadata: { source_channel: 'mcp' },
    });

    // Update message count
    const { count } = await supabase
      .from('conversation_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', convId);
    await supabase
      .from('conversation_logs')
      .update({ message_count: count ?? 0 })
      .eq('id', convId);

    // Extract and store memories (fire-and-forget)
    const memoryPattern = /\[MEMORY:(\w+):([^:]+):([^\]]+)\]/g;
    const validCategories = new Set(['preference', 'decision', 'context', 'fact']);
    let match;
    const memInserts = [];
    while ((match = memoryPattern.exec(assistantText)) !== null) {
      const category = match[1];
      const key = match[2].replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
      const content = match[3].slice(0, 2000);
      if (!validCategories.has(category) || !key || key.length < 2) continue;
      memInserts.push({
        workspace_id: workspaceId,
        user_id: userId,
        key: `onboarding:${key}`,
        content,
        category,
        source: 'onboarding-chat',
        importance_score: 0.8,
        tags: `onboarding,${key}`,
      });
    }
    if (memInserts.length > 0) {
      supabase
        .from('agent_memory')
        .upsert(memInserts, { onConflict: 'workspace_id,key' })
        .then(({ error: memErr }) => {
          if (memErr) console.error('[onboarding] Memory upsert failed:', memErr.message);
        });
    }

    // Strip memory tags for display
    const cleaned = assistantText.replace(/\[MEMORY:[^\]]+\]/g, '').trim();

    return textResult(cleaned);
  },
};
