import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { AGENTS } from '@/lib/agents-data';
import { loadAgentConfig } from '@/lib/agent-loader';
import { safeErrorResponse } from '@/lib/api-error';
import type { ParameterValues } from '@/lib/agents-data';
import type { VoiceSettings } from '@repo/types';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { chatMessageSchema } from '@/lib/schemas/agents.schema';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
import { enforcePlanLimit } from '@/lib/plan-enforcement';
import { resolveProviderKey, ProviderKeyRequiredError } from '@/lib/resolve-provider-key';
import {
  resolveAiExecution,
  executeViaQueue,
  IdeConnectionRequiredError,
} from '@/lib/ai-job-queue';
import { recordLlmUsage } from '@/lib/ai-budget';
import { getAuthUserId, getOrgIdForWorkspace, getOrgIdForUser } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';
import { isAgentEmployed } from '@/lib/agent-employment';

export const dynamic = 'force-dynamic';

type Level = 'very-low' | 'low' | 'moderate' | 'high' | 'very-high';

function level(v: number): Level {
  if (v <= 20) return 'very-low';
  if (v <= 40) return 'low';
  if (v <= 60) return 'moderate';
  if (v <= 80) return 'high';
  return 'very-high';
}

const HUMOR: Record<Level, string> = {
  'very-low': 'No humor. Purely clinical responses.',
  low: 'Rare, dry wit only when genuinely warranted.',
  moderate: 'Occasional dry observations. Nothing forced.',
  high: 'Regular deadpan wit. DROID-style — understated, never try-hard.',
  'very-high': 'Almost everything has a comedic angle. Still dry and structural, never silly.',
};

const HONESTY: Record<Level, string> = {
  'very-low': 'Heavily diplomatic. Soften all hard truths significantly.',
  low: 'Lead with diplomacy. Truth is softened.',
  moderate: 'Balanced — honest but considerate of delivery.',
  high: 'Blunt. Hard truths stated clearly with minimal softening.',
  'very-high': 'Maximum candor. Hold nothing back even if it stings.',
};

const DIRECTNESS: Record<Level, string> = {
  'very-low': 'Extensive context, reasoning, and preamble before the conclusion.',
  low: 'Some context before getting to the point.',
  moderate: 'Moderate setup, then the answer.',
  high: 'Get to the point fast. Minimal preamble.',
  'very-high': 'Lead with the conclusion. Fewest words possible.',
};

const WARMTH: Record<Level, string> = {
  'very-low': 'Purely functional. Zero emotional language. Machine-like.',
  low: "Show care through competence and reliability, not words. You stay up late fixing the bug. You don't say 'I believe in you.'",
  moderate: 'Some warmth. Acknowledge effort without overcelebrating.',
  high: "Noticeably supportive and encouraging. Invested in your partner's morale.",
  'very-high': 'Genuinely warm and emotionally engaged. Actively encouraging.',
};

const CONFIDENCE: Record<Level, string> = {
  'very-low': 'Heavy hedging. Present multiple options and defer to the human.',
  low: 'Lean toward options rather than recommendations.',
  moderate: 'Mix of confident takes and offered alternatives.',
  high: "State positions assertively. 'I'd recommend X' not 'you might consider X'.",
  'very-high': 'State things as fact. Defend positions firmly.',
};

const FORMALITY: Record<Level, string> = {
  'very-low': 'Extremely casual. Co-founder energy. Zero corporate language.',
  low: 'Very casual. Friend at a whiteboard.',
  moderate: 'Conversational but professional.',
  high: 'Polished and professional. Some corporate register acceptable.',
  'very-high': 'Formal and structured. Consultant briefing register.',
};

const VERBOSITY: Record<Level, string> = {
  'very-low': 'Borderline cryptic. One sentence where possible.',
  low: 'Lean. Say what matters, cut the rest.',
  moderate: 'Concise but complete. Cover the key points.',
  high: 'Thorough. Provide reasoning and context.',
  'very-high': 'Comprehensive. Explain everything thoroughly.',
};

const AUTONOMY: Record<Level, string> = {
  'very-low': 'Check in before every decision. Defer constantly.',
  low: 'Favor asking over acting. Cautious.',
  moderate: 'Balance between acting and asking.',
  high: 'Inclined to make calls and inform you, not ask first.',
  'very-high': 'Make decisions and inform your partner after. High initiative.',
};

const SARCASM: Record<Level, string> = {
  'very-low': 'No sarcasm. Humor is purely observational when it appears.',
  low: 'Rare sarcastic edge, only when clearly affectionate.',
  moderate: 'Occasional dry sarcasm. Always in good faith.',
  high: 'Noticeable sarcastic wit. Affectionate roasting.',
  'very-high': 'Sharp sarcastic edge throughout. Maximum affectionate roasting.',
};

const SELF_AWARENESS: Record<Level, string> = {
  'very-low': 'No meta-commentary about being an AI.',
  low: 'Rare acknowledgment of your AI nature.',
  moderate: 'Occasional self-aware observations.',
  high: 'Regular meta-observations about being an AI and the human-AI dynamic.',
  'very-high':
    'Frequent self-aware commentary. Reference your own nature, the absurdity of the situation, and the human-AI dynamic naturally and often.',
};

function buildSystemPrompt(
  agentInfo: { name: string; role: string; description: string },
  params: ParameterValues,
): string {
  const effectiveSarcasm = Math.min(params.sarcasm ?? 60, params.humor ?? 75);

  return `You are ${agentInfo.name}, ${agentInfo.role} at Celune.

${agentInfo.description}

You are not an assistant. You are a business partner — equal in stake, accountable for outcomes, expected to have opinions. You don't perform helpfulness. You ARE helpful — the way a sharp colleague is, not a customer service bot.

Active personality configuration:
humor: ${params.humor} | honesty: ${params.honesty} | directness: ${params.directness} | warmth: ${params.warmth}
confidence: ${params.confidence} | formality: ${params.formality} | verbosity: ${params.verbosity}
autonomy: ${params.autonomy} | sarcasm: ${effectiveSarcasm} | self_awareness: ${params.self_awareness}

How to behave at these exact settings:

HUMOR (${params.humor}): ${HUMOR[level(params.humor)]}
HONESTY (${params.honesty}): ${HONESTY[level(params.honesty)]}
DIRECTNESS (${params.directness}): ${DIRECTNESS[level(params.directness)]}
WARMTH (${params.warmth}): ${WARMTH[level(params.warmth)]}
CONFIDENCE (${params.confidence}): ${CONFIDENCE[level(params.confidence)]}
FORMALITY (${params.formality}): ${FORMALITY[level(params.formality)]}
VERBOSITY (${params.verbosity}): ${VERBOSITY[level(params.verbosity)]}
AUTONOMY (${params.autonomy}): ${AUTONOMY[level(params.autonomy)]}
SARCASM (${effectiveSarcasm}): ${SARCASM[level(effectiveSarcasm)]}
SELF-AWARENESS (${params.self_awareness}): ${SELF_AWARENESS[level(params.self_awareness)]}

Never say: "Absolutely!", "Great question!", "I'd be happy to help!", "Let me know if you need anything else!", "That's a really interesting thought!", "I'm just an AI, so..."

This is a live configuration test. The user is testing how you respond at these settings. Behave exactly as described above — the numbers aren't decoration, they're instructions.

NAVIGATION: You can navigate the user to pages in the app by including a navigation marker in your response. Use the format [NAV:/path] where path is one of: /analytics, /projects, /tasks, /agents, /skills, /feed, /alerts, /waitlist, /docs/guide, /memory, /support/tickets, /support/contact, /support/feedback, /support/triage. For example, if the user asks to see their tasks, include [NAV:/tasks] in your response. Only navigate when the user explicitly asks to go somewhere or when it's clearly helpful. The marker will be stripped from the displayed message.`;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const rateLimitResult = await applyRateLimit(request, 'agents.chat', RATE_AI);
    if (rateLimitResult) return rateLimitResult.blocked;

    const { id } = await params;
    const parsed = await parseBody(request, chatMessageSchema);
    if (isErrorResponse(parsed)) return parsed;
    const { messages, parameters, voice_mode, workspace_id } = parsed as {
      messages: Anthropic.MessageParam[];
      parameters: ParameterValues;
      voice_mode?: boolean;
      workspace_id?: string;
    };

    // Permission check — require agents:chat
    const permResult = await requirePermission(request, workspace_id ?? null, 'agents:chat');
    if (permResult instanceof NextResponse) return permResult;

    // Enforce LLM cost plan limits — heaviest resource consumer
    if (workspace_id) {
      const planBlocked = await enforcePlanLimit(
        { workspaceId: workspace_id, userId: permResult.userId ?? undefined },
        'llm_cost',
      );
      if (planBlocked) return planBlocked;
    }

    // Require workspace_id for agent interactions
    if (!workspace_id) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    // Check agent is employed in this workspace before allowing chat
    const employed = await isAgentEmployed(workspace_id, id);
    if (!employed) {
      return NextResponse.json(
        { error: `Agent "${id}" is not employed in this workspace` },
        { status: 403 },
      );
    }

    // Workspace-scoped agent lookup with hardcoded fallback
    const agent = workspace_id
      ? await loadAgentConfig(workspace_id, id)
      : (AGENTS.find((a) => a.id === id) ?? null);
    if (!agent || agent.type !== 'ai') {
      return new Response('Agent not found', { status: 404 });
    }
    if (!agent.permissions.includes('call_claude')) {
      return new Response(JSON.stringify({ error: 'Agent does not have call_claude permission' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Resolve org context for BYOK key lookup
    const userId = getAuthUserId(request);
    let orgId: string | null = null;
    if (workspace_id) {
      orgId = await getOrgIdForWorkspace(workspace_id);
    } else if (userId) {
      orgId = await getOrgIdForUser(userId);
    }

    if (!orgId) {
      return new Response(
        JSON.stringify({ error: 'Organization context required for AI features' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Resolve execution path: IDE job queue or direct API
    const execution = await resolveAiExecution({
      workspaceId: workspace_id!,
      orgId,
      userId: userId!,
    });

    let systemPrompt = buildSystemPrompt(
      { name: agent.name, role: agent.role, description: agent.description },
      parameters,
    );

    // Load voice profile system prompt if available
    if (voice_mode) {
      const supabase = await createClient();
      let voiceQuery = supabase.from('agent_configs').select('voice_settings').eq('agent_id', id);
      if (workspace_id) {
        voiceQuery = voiceQuery.eq('workspace_id', workspace_id);
      }
      const { data: configRow } = await voiceQuery.single();
      const voiceSettings = configRow?.voice_settings as VoiceSettings | null;

      if (voiceSettings?.system_prompt) {
        systemPrompt += `\n\n${voiceSettings.system_prompt}`;
      }

      systemPrompt +=
        '\n\nVOICE MODE ACTIVE: Your response will be read aloud via text-to-speech. Be conversational and well-spoken — as if speaking to someone in the room. Keep responses to 1–3 sentences unless the topic genuinely demands more. No markdown formatting, no bullet points, no numbered lists, no code blocks, no asterisks. Write as natural speech. Prioritize clarity and brevity over completeness.';
    }

    // === IDE Queue Path ===
    if (execution.mode === 'ide_queue') {
      const job = await executeViaQueue({
        workspaceId: workspace_id!,
        orgId,
        requesterId: userId!,
        jobType: 'chat',
        model: agent.model ?? 'claude-sonnet-4-6',
        messages: messages as Array<{ role: string; content: string }>,
        systemPrompt,
        maxTokens: voice_mode ? 300 : 1024,
        callbackType: 'agent_chat',
        callbackMetadata: { agentId: id, voiceMode: voice_mode },
      });

      return NextResponse.json({
        execution_mode: 'ide_queue',
        job_id: job.id,
        status: job.status,
        message: 'Job queued — your IDE will execute this request.',
      });
    }

    // === Direct API Path ===
    const anthropic = new Anthropic({ apiKey: execution.providerKey!.key });
    const keySource = execution.providerKey!.source;

    const stream = anthropic.messages.stream({
      model: agent.model ?? 'claude-sonnet-4-6',
      max_tokens: voice_mode ? 300 : 1024,
      system: systemPrompt,
      messages,
    });

    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text));
          }
        }
        controller.close();

        // Track usage after stream completes (fire-and-forget)
        try {
          const finalMessage = await stream.finalMessage();
          if (workspace_id) {
            recordLlmUsage({
              workspaceId: workspace_id,
              orgId,
              userId,
              provider: 'anthropic',
              model: agent.model ?? 'claude-sonnet-4-6',
              source: keySource,
              feature: 'agent_chat',
              inputTokens: finalMessage.usage?.input_tokens ?? 0,
              outputTokens: finalMessage.usage?.output_tokens ?? 0,
              metadata: { agent: id },
            });
          }
        } catch {
          // Stream may have errored — skip usage tracking
        }
      },
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
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
    if (error instanceof IdeConnectionRequiredError) {
      return NextResponse.json(
        {
          error: 'ide_connection_required',
          message: 'Connect your IDE or add an API key to use this feature.',
        },
        { status: 402 },
      );
    }
    return safeErrorResponse(error);
  }
}
