import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { getAuthUserId, getOrgIdForWorkspace } from '@/lib/auth';
import { resolveProviderKey, ProviderKeyRequiredError } from '@/lib/resolve-provider-key';
import { recordLlmUsage } from '@/lib/ai-budget';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
import { onboardingProfileSchema } from '@/lib/schemas/onboarding.schema';
import { requireWorkspaceMembership } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Generate a user profile summary from onboarding chat memories.
 *
 * POST /api/onboarding/profile
 * Body: { workspace_id: string }
 *
 * Returns: { profile: { summary, role, goals, working_style, agent_team, suggested_project } }
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'onboarding.profile.post', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.json();
    const parsed = onboardingProfileSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id } = parsed.data;

    // Verify workspace membership
    const membershipError = await requireWorkspaceMembership(userId, workspace_id);
    if (membershipError) return membershipError;

    // Fetch onboarding memories
    const supabase = createServiceClient();
    const { data: memories } = await supabase
      .from('agent_memory')
      .select('key, content, category')
      .eq('workspace_id', workspace_id)
      .eq('user_id', userId)
      .eq('source', 'onboarding-chat')
      .order('created_at', { ascending: true });

    if (!memories || memories.length === 0) {
      return NextResponse.json(
        { error: 'No onboarding memories found. Complete the conversation first.' },
        { status: 400 },
      );
    }

    // Format memories for the AI
    const memoryContext = memories
      .map((m) => `[${m.category}] ${m.key.replace('onboarding:', '')}: ${m.content}`)
      .join('\n');

    // Resolve Anthropic API key
    const orgId = await getOrgIdForWorkspace(workspace_id);

    if (!orgId) {
      return NextResponse.json({ error: 'No Anthropic API key configured' }, { status: 503 });
    }
    const resolved = await resolveProviderKey('anthropic', orgId, workspace_id, {
      userId,
      skipByokGate: true,
    });

    const anthropic = new Anthropic({ apiKey: resolved.key });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `Based on the following memories from an onboarding conversation, generate a user profile.

## Memories
${memoryContext}

## Instructions
Return ONLY valid JSON (no markdown fences) with this exact structure:
{
  "summary": "2-3 sentence overview of who this person is and what they're working on",
  "role": "Their role/title (e.g. 'Founder & CEO', 'Senior Developer', 'Product Manager')",
  "goals": ["Goal 1", "Goal 2", "Goal 3"],
  "working_style": "1-2 sentences about how they prefer to work",
  "challenges": ["Challenge 1", "Challenge 2"],
  "agent_team": [
    { "name": "Lead", "role": "Lead Agent", "reason": "Why this agent fits their needs" },
    { "name": "Second agent name", "role": "Agent role", "reason": "Why" }
  ],
  "suggested_project": {
    "name": "Project name tailored to their #1 goal",
    "description": "What the project would accomplish",
    "tasks": ["Task 1", "Task 2", "Task 3", "Task 4", "Task 5"]
  }
}

The agent_team should include 2-4 agents that would be most useful for this person. Always include Lead as the first agent. Pick from: Lead (coordination), Sage (PM/strategy), Noir (design), Scan (code review), Delv (research), Trek (career), Echo (brand/content), Bond (relationships), Vita (wellness/habits).

The suggested_project should be specific to their stated goals — not generic.`,
        },
      ],
    });
    recordLlmUsage({
      workspaceId: workspace_id,
      orgId,
      userId,
      provider: 'anthropic',
      model: response.model,
      source: resolved.source,
      feature: 'onboarding_profile',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';

    // Parse the JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to generate profile' }, { status: 500 });
    }

    try {
      const profile = JSON.parse(jsonMatch[0]);
      return NextResponse.json({ profile });
    } catch {
      return NextResponse.json({ error: 'Failed to parse profile' }, { status: 500 });
    }
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
