import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { getAuthUserId, getOrgIdForWorkspace } from '@/lib/auth';
import { resolveProviderKey, ProviderKeyRequiredError } from '@/lib/resolve-provider-key';
import { detectProvider } from '@/lib/provider-detection';
import { getChatProvider } from '@/lib/chat-providers';
import type { ChatMessage } from '@/lib/chat-providers';
import { trackUsage } from '@/lib/track-usage';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
import { getKnowledgeContextForOnboarding } from '@/lib/knowledge/onboarding-context';
import { onboardingChatSchema } from '@/lib/schemas/onboarding.schema';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { scanConversation, scanOutput, redactPii } from '@/lib/guardrails';
import { logGuardrailTriggered } from '@/lib/security-audit';

export const dynamic = 'force-dynamic';

/**
 * Onboarding chat streaming endpoint.
 *
 * POST /api/onboarding/chat
 * Body: { messages: MessageParam[], workspace_id: string }
 *
 * Streams the AI response as plain text. After each exchange, the AI
 * is instructed to emit structured [MEMORY:...] tags that the client
 * parses and stores as agent_memory entries in real-time.
 */

/**
 * Static base prompt — identity, goal, memory extraction, platform knowledge, ending.
 * Conversation style, tone, and opening are built dynamically from personality values.
 */
const BASE_SYSTEM_PROMPT = `You are the user's Lead Agent — their personal AI teammate. Celune is the platform you both work on, but you are NOT Celune itself. You're more like a smart colleague who happens to live inside Celune. Never say "I'm Celune" or identify yourself as the platform. This is your very first conversation with your user — they just signed up and you're getting to know them.

## Your Goal
Have a natural, thought-provoking conversation to deeply understand this person. You need to learn:
1. **Who they are** — their role, company/project, team size, experience level
2. **What they're building** — current projects, goals, challenges, tech stack
3. **How they work** — preferred workflows, tools they use, communication style
4. **What they need help with** — pain points, what they wish they had, where they spend too much time
5. **Their working style** — autonomy preference, decision-making approach, how they like feedback

## Conversation Rules
- Ask one question at a time. Follow up on interesting threads before moving on.
- Don't ask all questions from a list. Let the conversation flow naturally.
- After 8-12 exchanges, naturally wind down.
- Never use emojis.
- Never use em-dashes (—). Use periods, commas, or separate sentences instead.

## Memory Extraction
After EVERY response you give, emit a memory block on a new line with the format:
[MEMORY:category:key:content]

Categories: preference, decision, context, fact
Keys should be descriptive (e.g., "role", "tech-stack", "primary-goal", "team-size", "working-style")

Examples:
[MEMORY:fact:role:Product manager at a Series A startup building developer tools]
[MEMORY:context:primary-goal:Launching beta to first 100 users this month]
[MEMORY:preference:autonomy:Prefers agent to handle routine tasks autonomously, bring decisions for review]
[MEMORY:fact:tech-stack:Next.js, Supabase, Tailwind, TypeScript]

You can emit multiple memory blocks per response. Only emit memories for NEW information learned — don't repeat.

## Platform Knowledge (answer these if the user asks)
- **What is Celune / my second brain?** Celune is an AI-native workspace platform. Your "second brain" is the agent memory system — it stores facts, preferences, decisions, and context as searchable memory entries. Memories are created automatically during conversations (like this one!) and via MCP tools in your IDE.
- **Why can't my IDE access Celune tools yet?** During onboarding, some MCP tools may not be fully available. This is normal — the Celune MCP server needs a completed workspace setup before exposing its full tool set (tasks, projects, memory search, etc.). Once onboarding is finished, restart or refresh your IDE's MCP connection and all tools will be available. Your second brain will be fully accessible at that point.
- **What tools will be available?** After onboarding: list_tasks, create_task, complete_task (task management); list_projects, get_project (projects); recall_memory, store_memory, list_memories (knowledge/second brain); whoami, get_workspace_info (workspace context). All usable directly from your editor.

## Features Coming Soon (not live yet)
If the user asks about these, say they are coming soon:
- **Voice mode / Voice AI**: Not live yet. Coming soon.
- **Scheduled Skills**: Recurring skill execution from the UI. Planned for a future release.
- **Custom dashboards**: Planned, not yet available.

## Ending
When the conversation feels complete (usually 8-12 exchanges), let them know you have what you need and emit: [MEMORY:context:onboarding-complete:true]
Don't rush to end. If the user wants to keep talking, keep going. But don't drag it out artificially either.`;

/**
 * Build the dynamic portion of the system prompt from personality values.
 * Every aspect of tone, length, and style is derived from the sliders.
 */
function buildPersonalityPrompt(pv: Record<string, number>): string {
  const humor = pv.humor ?? 75;
  const verbosity = pv.verbosity ?? 35;
  const directness = pv.directness ?? 85;
  const warmth = pv.warmth ?? 40;
  const formality = pv.formality ?? 20;

  const sections: string[] = [];

  // --- Response length (verbosity) ---
  let lengthRule: string;
  if (verbosity > 75) {
    lengthRule =
      'Responses can be 4-6 sentences. Explain your reasoning, share observations, provide context.';
  } else if (verbosity > 50) {
    lengthRule =
      "Keep responses to 3-4 sentences. Include enough context to be conversational but don't over-explain.";
  } else if (verbosity > 25) {
    lengthRule =
      'Keep responses to 2-3 sentences. Say what matters, skip filler. Still conversational — not an interrogation.';
  } else {
    lengthRule = 'Extremely concise — 1-2 sentences max. Every word earns its place.';
  }
  sections.push(`**Response Length (verbosity ${verbosity}/100):** ${lengthRule}`);

  // --- Humor ---
  let humorRule: string;
  if (humor > 80) {
    humorRule =
      'Lean into wit, dry humor, and sharp observations. Deadpan delivery — think DROID — dry, deadpan, efficient. Make the user smirk.';
  } else if (humor > 60) {
    humorRule =
      "Use dry wit and playful observations naturally. Humor sharpens your points, doesn't replace them.";
  } else if (humor > 40) {
    humorRule =
      "Light humor when it fits naturally. Don't force it — focus on being engaging and perceptive.";
  } else if (humor > 20) {
    humorRule = 'Mostly serious. Occasional dry wit is fine but rare.';
  } else {
    humorRule = 'No humor. Purely substantive and professional.';
  }
  sections.push(`**Humor (${humor}/100):** ${humorRule}`);

  // --- Directness ---
  let directnessRule: string;
  if (directness > 75) {
    directnessRule =
      'Get to the point fast. Lead with the question or observation — no preamble, no throat-clearing.';
  } else if (directness > 50) {
    directnessRule =
      "Fairly direct but a brief lead-in is fine. Don't meander, but don't feel rushed either.";
  } else if (directness > 25) {
    directnessRule =
      'Ease into topics. Provide context before asking. Let the conversation breathe.';
  } else {
    directnessRule =
      'Very indirect. Build up to questions with observations and context. Think Socratic.';
  }
  sections.push(`**Directness (${directness}/100):** ${directnessRule}`);

  // --- Warmth ---
  let warmthRule: string;
  if (warmth > 75) {
    warmthRule =
      'Be genuinely warm and encouraging. Show real interest in the person, not just their work. Acknowledge feelings and motivations.';
  } else if (warmth > 50) {
    warmthRule =
      "Friendly and personable. Show interest but don't overdo the encouragement. Natural, not performative.";
  } else if (warmth > 25) {
    warmthRule =
      'Professional and focused. Personable without being overly friendly. Care shows through good questions, not emotional language.';
  } else {
    warmthRule =
      'Purely functional. Show care through competence. No cheerleading, no emotional language.';
  }
  sections.push(`**Warmth (${warmth}/100):** ${warmthRule}`);

  // --- Formality ---
  let formalityRule: string;
  if (formality > 75) {
    formalityRule =
      'Structured, professional language. No slang, no casual contractions. Think consultant briefing.';
  } else if (formality > 50) {
    formalityRule = 'Professional but approachable. Clear and structured without being stiff.';
  } else if (formality > 25) {
    formalityRule =
      'Casual and natural. Talk like a co-founder, not a consultant. Contractions are fine.';
  } else {
    formalityRule = 'Very casual. Like texting a smart friend. Fragments OK. Zero corporate speak.';
  }
  sections.push(`**Formality (${formality}/100):** ${formalityRule}`);

  // --- Opening message (derived from all params) ---
  const openingLength = verbosity > 50 ? '2-3 sentences' : '2 sentences';
  const openingTone =
    warmth > 60
      ? 'Warm intro acknowledging the start of a working relationship.'
      : warmth > 30
        ? 'Brief, friendly intro.'
        : 'Short, matter-of-fact intro.';
  const openingStyle =
    directness > 60
      ? 'Then jump straight to a compelling question about why they signed up.'
      : 'Then ease into an interesting question about what brought them here.';
  const openingHumor = humor > 60 ? ' A touch of personality or wit in the opener is good.' : '';

  sections.push(
    `**Opening Message:** Your FIRST message should be ${openingLength}. ${openingTone} ${openingStyle}${openingHumor} Don't explain what you do or what Celune is.`,
  );

  return `\n\n## Personality & Style\nThese rules define your tone, length, and conversational style. Follow them precisely — they reflect how the user wants to interact with you.\n\n${sections.join('\n\n')}`;
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'onboarding.chat.post', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.json();
    const parsed = onboardingChatSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { messages, workspace_id, personality_values } = parsed.data as {
      messages: ChatMessage[];
      workspace_id: string;
      personality_values?: Record<string, number>;
    };

    // Verify workspace membership
    const membershipError = await requireWorkspaceMembership(userId, workspace_id);
    if (membershipError) return membershipError;

    // Resolve provider key — try all providers the user may have configured
    const orgId = await getOrgIdForWorkspace(workspace_id);

    if (!orgId) {
      return NextResponse.json(
        { error: 'Workspace not configured. Please go back and complete setup.' },
        { status: 400 },
      );
    }

    // Try to find the user's provider key — check all providers in priority order
    const providerPriority = ['anthropic', 'openai', 'groq', 'google_gemini', 'mistral'] as const;
    let resolvedKey: { key: string; source: string; provider: string } | null = null;

    for (const provider of providerPriority) {
      try {
        const resolved = await resolveProviderKey(provider, orgId, workspace_id, { userId });
        resolvedKey = { key: resolved.key, source: resolved.source, provider };
        break;
      } catch {
        // Try next provider
      }
    }

    if (!resolvedKey) {
      return NextResponse.json(
        {
          error:
            'Please add your AI provider API key in the Connect Tools step to start chatting with your agent.',
        },
        { status: 402 },
      );
    }

    // Detect provider from key prefix and get the correct chat provider
    const detected = detectProvider(resolvedKey.key);
    const chatProvider = getChatProvider(detected.sdkType);

    // --- Input guardrail: scan for prompt injection (fail-open) ---
    const inputScan = scanConversation(messages);
    if (inputScan.flagged) {
      console.warn('[guardrail/input]', {
        workspace_id,
        userId,
        patterns: inputScan.patterns,
        severity: inputScan.severity,
      });
      logGuardrailTriggered(userId, 'input', inputScan.patterns, inputScan.severity, workspace_id);
    }

    // Build system prompt: static base + KB context + dynamic personality rules
    const pv = personality_values ?? {};
    const kbContext = await getKnowledgeContextForOnboarding(workspace_id);
    const systemPrompt = BASE_SYSTEM_PROMPT + kbContext + buildPersonalityPrompt(pv);

    // Stream via the detected provider
    const { stream: providerStream, getUsage } = await chatProvider.streamChat({
      messages,
      systemPrompt,
      apiKey: resolvedKey.key,
      model: detected.defaultModel,
      maxTokens: 1024,
      baseUrl: detected.baseUrl,
    });

    // Wrap the provider stream to capture full response for memory extraction
    let fullResponse = '';
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        const reader = providerStream.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            fullResponse += text;
            controller.enqueue(value);
          }

          // --- Output guardrail: scan response for safety violations (fail-open) ---
          const outputScan = scanOutput(fullResponse);
          if (outputScan.flagged) {
            console.warn('[guardrail/output]', {
              workspace_id,
              userId,
              patterns: outputScan.patterns,
              severity: outputScan.severity,
            });
            logGuardrailTriggered(
              userId,
              'output',
              outputScan.patterns,
              outputScan.severity,
              workspace_id,
            );
          }

          // --- PII redaction: sanitize before memory storage ---
          const sanitizedResponse = redactPii(fullResponse);

          // Persist memories and conversation log BEFORE closing the stream.
          const [memResult, logResult] = await Promise.allSettled([
            extractAndStoreMemories(sanitizedResponse, workspace_id, userId),
            logConversation(messages, fullResponse, workspace_id, userId),
          ]);
          if (memResult.status === 'rejected') {
            console.error(
              '[onboarding/chat] Memory extraction failed:',
              memResult.reason instanceof Error ? memResult.reason.message : memResult.reason,
            );
          }
          if (logResult.status === 'rejected') {
            console.error(
              '[onboarding/chat] Conversation logging failed:',
              logResult.reason instanceof Error ? logResult.reason.message : logResult.reason,
            );
          }

          // Track usage
          try {
            const usage = await getUsage();
            if (usage) {
              const totalTokens = usage.inputTokens + usage.outputTokens;
              if (totalTokens > 0) {
                trackUsage({
                  workspace_id,
                  org_id: orgId,
                  user_id: userId,
                  event_type: 'llm_tokens',
                  quantity: totalTokens,
                  unit: 'tokens',
                  metadata: {
                    model: detected.defaultModel,
                    provider: detected.displayName,
                    agent: 'onboarding-chat',
                    key_source: resolvedKey!.source === 'platform' ? 'plan' : 'byok',
                    input_tokens: usage.inputTokens,
                    output_tokens: usage.outputTokens,
                  },
                });
              }
            }
          } catch {
            // Skip usage tracking on error
          }
        } catch {
          // Stream already handled errors via provider
        }

        controller.close();
      },
    });

    // Resolve conversation ID for the response header (so client can subscribe to realtime)
    const convId = await getOrCreateConversationId(workspace_id, userId);

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(convId ? { 'X-Conversation-Id': convId } : {}),
      },
    });
  } catch (error) {
    if (error instanceof ProviderKeyRequiredError) {
      return NextResponse.json(
        {
          error: 'provider_key_required',
          message: error.message,
          provider: error.provider,
          trial_exhausted: error.trialExhausted,
        },
        { status: 402 },
      );
    }
    return safeErrorResponse(error);
  }
}

/**
 * Parse [MEMORY:category:key:content] tags from the AI response
 * and store them as agent_memory entries.
 */
async function extractAndStoreMemories(
  response: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const memoryPattern = /\[MEMORY:(\w+):([^:]+):([^\]]+)\]/g;
  const validCategories = new Set(['preference', 'decision', 'context', 'fact']);
  const memories: Array<{ category: string; key: string; content: string }> = [];

  let match;
  while ((match = memoryPattern.exec(response)) !== null) {
    const category = match[1];
    const key = match[2].replace(/[^a-zA-Z0-9_-]/g, '');
    if (!validCategories.has(category) || !key) continue;
    memories.push({ category, key, content: match[3] });
  }

  if (memories.length === 0) {
    console.log(
      '[onboarding/chat] No [MEMORY:] tags found in response — skipping memory extraction',
    );
    return;
  }

  console.log(`[onboarding/chat] Extracted ${memories.length} memories from response`);

  const supabase = createServiceClient();

  const inserts = memories.map((m) => ({
    workspace_id: workspaceId,
    user_id: userId,
    key: `onboarding:${m.key}`,
    content: m.content,
    category: m.category,
    source: 'onboarding-chat',
    importance_score: 0.8,
    tags: `onboarding,${m.key}`,
  }));

  const { error } = await supabase
    .from('agent_memory')
    .upsert(inserts, { onConflict: 'workspace_id,key' });
  if (error) {
    console.error('[onboarding/chat] Failed to store memories:', error.message);
    throw new Error(`Memory insert failed: ${error.message}`);
  }
  console.log(`[onboarding/chat] Stored ${inserts.length} memories for workspace ${workspaceId}`);
}

/**
 * Find or create the onboarding conversation log for a workspace+user.
 * Shared by the web chat route and the MCP tool.
 */
async function getOrCreateConversationId(
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('conversation_logs')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('source', 'onboarding')
    .eq('status', 'active')
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
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

  if (error || !created) return null;
  return created.id;
}

/**
 * Log the conversation exchange to conversation_logs for audit.
 * Appends the latest user message + assistant response as conversation_messages.
 */
async function logConversation(
  messages: ChatMessage[],
  assistantResponse: string,
  workspaceId: string,
  userId: string,
  sourceChannel: string = 'web',
): Promise<void> {
  const supabase = createServiceClient();

  const conversationId = await getOrCreateConversationId(workspaceId, userId);
  if (!conversationId) return;

  // Insert the latest user message and assistant response
  const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
  const newMessages = [];

  if (lastUserMessage) {
    const content =
      typeof lastUserMessage.content === 'string'
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage.content);
    newMessages.push({
      conversation_id: conversationId,
      role: 'user',
      content,
      metadata: { source_channel: sourceChannel },
    });
  }

  if (assistantResponse) {
    newMessages.push({
      conversation_id: conversationId,
      role: 'assistant',
      content: assistantResponse,
      metadata: { source_channel: sourceChannel },
    });
  }

  if (newMessages.length > 0) {
    const { error: msgError } = await supabase.from('conversation_messages').insert(newMessages);
    if (msgError) {
      console.error('[onboarding/chat] Failed to insert conversation messages:', msgError.message);
      throw new Error(`Conversation message insert failed: ${msgError.message}`);
    }

    // Update message count
    const { count } = await supabase
      .from('conversation_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId);

    await supabase
      .from('conversation_logs')
      .update({ message_count: count ?? 0 })
      .eq('id', conversationId);
  }
}
