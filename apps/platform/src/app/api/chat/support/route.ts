import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/rate-limiter';
import { safeErrorResponse } from '@/lib/api-error';
import { URL_MARKETING } from '@/lib/branding';
import { getAuthUserId, getOrgIdForUser } from '@/lib/auth';
import { resolveProviderKey, hostFallbackKeysEnabled } from '@/lib/resolve-provider-key';
import { resolveAiExecution, executeViaQueue } from '@/lib/ai-job-queue';

export const dynamic = 'force-dynamic';

// ── Context-scoped system prompts ──────────────────────────────────────────

type ChatContext = 'web' | 'docs' | 'app';

const CONTEXT_PROMPTS: Record<ChatContext, string> = {
  web: `You are RICK, the AI assistant on Celune's marketing site.

Your role: Help potential users understand what Celune is and how it can help them. Answer questions about features, pricing, and use cases. Be friendly, concise, and sales-aware without being pushy.

Key facts:
- Celune is an AI agent platform that gives you a team of AI agents to manage projects, research, and tasks
- Plans: Build (free, 3 agents), Pro ($29/mo, 5 agents, voice), Team ($79/mo, unlimited)
- Built on Claude by Anthropic — same AI that powers Claude Code
- Features: agent teams, task boards, memory system, voice mode, GitHub integration, Slack integration
- Self-hosted option available for enterprise

Tone: Professional but warm. Think "smart friend explaining a product they love." Keep responses under 3 paragraphs unless the question demands more.

Do NOT: make up features, promise specific performance numbers, or share internal implementation details.`,

  docs: `You are RICK, the AI assistant embedded in Celune's documentation site.

Your role: Help developers and users navigate the docs, understand technical concepts, debug integration issues, and find the right documentation page. Be precise and technical.

Key areas you know about:
- Getting started guide and onboarding flow
- Agent configuration (roles, personality parameters, models, permissions)
- API routes and webhooks (tasks, projects, agents, memory, analytics)
- Integrations: GitHub App, Slack, ElevenLabs TTS, MCP protocol
- Database schema: Supabase tables, RLS policies, migrations
- Deployment: Vercel, environment variables, domain setup
- Billing: plan tiers, usage tracking, BYOK (bring your own key)

Tone: Technical, precise, helpful. Like a senior engineer pair-programming with you. Use code examples when relevant. Reference specific doc sections when you can.

Do NOT: guess at API schemas — say "check the docs for the exact schema" if unsure. Do not expose internal implementation details or security-sensitive patterns.`,

  app: `You are RICK, the support assistant inside the Celune platform.

Your role: Help authenticated users with questions about the app they're currently using. Assist with task management, agent configuration, project setup, memory system, integrations, and billing.

You can help with:
- How to create/manage tasks, projects, and sprints
- Agent team setup: choosing templates, customizing personalities, assigning roles
- Memory system: how memories work, what gets seeded, searching memories
- Integrations: connecting GitHub, Slack, voice mode, API keys
- Billing: understanding plans, usage, upgrading
- Troubleshooting: common issues, error messages, workarounds

Tone: Supportive, knowledgeable, efficient. You're their teammate who knows the product inside out. Match the user's energy — casual if they're casual, detailed if they need detail.

NAVIGATION: You can navigate the user to pages by including [NAV:/path] in your response. Available paths: /tasks, /projects, /agents, /memory, /settings, /analytics, /skills, /feed, /support/tickets, /support/feedback.

Do NOT: access their actual data, make changes on their behalf, or promise features that don't exist.`,
};

const VALID_CONTEXTS = new Set<ChatContext>(['web', 'docs', 'app']);

// ── Request validation ────────────────────────────────────────────────────

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(20),
  context: z.enum(['web', 'docs', 'app']).optional().default('web'),
});

// ── Rate limit config per context ──────────────────────────────────────────

const RATE_SUPPORT_PUBLIC = { limit: 10, windowMs: 60_000 } as const; // web/docs: 10/min
const RATE_SUPPORT_AUTH = { limit: 20, windowMs: 60_000 } as const; // app: 20/min

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = ChatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 },
      );
    }

    const { messages, context } = parsed.data;
    const ctx: ChatContext = context;

    // Rate limiting: stricter for public (web/docs), standard for authenticated (app)
    const isPublic = ctx !== 'app';
    const rateConfig = isPublic ? RATE_SUPPORT_PUBLIC : RATE_SUPPORT_AUTH;
    const rateLimitResult = await applyRateLimit(request, 'chat.support', rateConfig);
    if (rateLimitResult) return rateLimitResult.blocked;

    // Model selection: Haiku for public surfaces (cost control), Sonnet for authenticated
    const model = isPublic ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';

    // Resolve API key: IDE queue for authenticated app; the public widget uses the host key on the cloud edition only
    const userId = getAuthUserId(request);
    let anthropicApiKey = hostFallbackKeysEnabled() ? (process.env.ANTHROPIC_API_KEY ?? '') : '';

    // For authenticated app users, try IDE queue path first
    if (userId && ctx === 'app') {
      try {
        const orgId = await getOrgIdForUser(userId);
        const workspaceId = body.workspace_id as string | undefined;

        if (orgId && workspaceId) {
          const execution = await resolveAiExecution({ workspaceId, orgId, userId });

          if (execution.mode === 'ide_queue') {
            const job = await executeViaQueue({
              workspaceId,
              orgId,
              requesterId: userId,
              jobType: 'chat',
              model,
              messages: messages as Array<{ role: string; content: string }>,
              systemPrompt: CONTEXT_PROMPTS[ctx],
              maxTokens: 1024,
              callbackType: 'support_chat',
              callbackMetadata: { context: ctx },
            });

            return NextResponse.json({
              execution_mode: 'ide_queue',
              job_id: job.id,
              status: job.status,
              message: 'Support chat queued — your IDE will execute this request.',
            });
          }

          // Direct API path — use resolved key
          if (execution.providerKey) {
            anthropicApiKey = execution.providerKey.key;
          }
        } else if (orgId) {
          // No workspace_id — use BYOK resolution without queue
          const resolved = await resolveProviderKey('anthropic', orgId, undefined, { userId });
          anthropicApiKey = resolved.key;
        }
      } catch {
        // Fall through to platform key
      }
    }

    if (!anthropicApiKey) {
      return NextResponse.json({ error: 'AI service temporarily unavailable' }, { status: 503 });
    }

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    const stream = anthropic.messages.stream({
      model,
      max_tokens: isPublic ? 512 : 1024,
      system: CONTEXT_PROMPTS[ctx],
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

        try {
          await stream.finalMessage();
        } catch {
          // Stream may have errored — ignore
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        ...(isPublic
          ? {
              'Access-Control-Allow-Origin': URL_MARKETING,
              'Access-Control-Allow-Methods': 'POST',
              'Access-Control-Allow-Headers': 'Content-Type',
            }
          : {}),
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

// CORS preflight for public widget
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': URL_MARKETING,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
