import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId, getOrgIdForWorkspace } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { resolveProviderKey, ProviderKeyRequiredError } from '@/lib/resolve-provider-key';
import { buildSupportChatPrompt } from '@/lib/support-chat-prompt';
import { createServiceClient } from '@repo/db/service';

export const dynamic = 'force-dynamic';

const supportChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(50),
  workspace_id: z.string().uuid(),
  conversation_id: z.string().uuid().optional(),
  page_path: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const rateLimitResult = await applyRateLimit(request, 'support.chat', RATE_AI);
    if (rateLimitResult) return rateLimitResult.blocked;

    const parsed = await parseBody(request, supportChatSchema);
    if (isErrorResponse(parsed)) return parsed;
    const { messages, workspace_id } = parsed;

    // Auth + workspace membership
    const userId = getAuthUserId(request);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const membershipError = await requireWorkspaceMembership(userId, workspace_id);
    if (membershipError) return membershipError;

    // Resolve workspace name for prompt context
    const supabase = createServiceClient();
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name, org_id')
      .eq('id', workspace_id)
      .single();

    // Resolve Anthropic API key (BYOK → platform fallback)
    const orgId = workspace?.org_id ?? (await getOrgIdForWorkspace(workspace_id));
    let anthropicApiKey: string;
    try {
      if (!orgId) throw new Error('Workspace has no organization');
      const resolved = await resolveProviderKey('anthropic', orgId, workspace_id, { userId });
      anthropicApiKey = resolved.key;
    } catch {
      return new Response(JSON.stringify({ error: 'No Anthropic API key configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const systemPrompt = buildSupportChatPrompt(workspace?.name ?? undefined, parsed.page_path);

    // ── Resolve or create conversation log ──────────────────────────────────
    const conversationId = parsed.conversation_id ?? null;
    let convId = conversationId;

    if (!convId) {
      // First message in a new conversation — create a log entry
      const { data: conv } = await supabase
        .from('conversation_logs')
        .insert({
          user_id: userId,
          workspace_id: workspace_id,
          source: 'web_chat',
          agent_id: 'support',
          status: 'active',
          message_count: 0,
        })
        .select('id')
        .single();
      convId = conv?.id ?? null;
    }

    // Persist the user's latest message
    const latestUserMsg = messages[messages.length - 1];
    if (convId && latestUserMsg?.role === 'user') {
      await supabase.from('conversation_messages').insert({
        conversation_id: convId,
        role: 'user',
        content: latestUserMsg.content,
      });
      await supabase
        .from('conversation_logs')
        .update({
          message_count: messages.filter((m) => m.role === 'user').length,
        })
        .eq('id', convId);
    }

    const stream = anthropic.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages,
    });

    // Collect assistant response to persist after streaming
    let fullAssistantText = '';
    const finalConvId = convId;

    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            fullAssistantText += chunk.delta.text;
            controller.enqueue(new TextEncoder().encode(chunk.delta.text));
          }
        }
        controller.close();

        // Persist assistant response
        if (finalConvId && fullAssistantText) {
          await supabase.from('conversation_messages').insert({
            conversation_id: finalConvId,
            role: 'assistant',
            content: fullAssistantText,
          });
          await supabase
            .from('conversation_logs')
            .update({
              message_count: messages.length + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', finalConvId);
        }
      },
    });

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
