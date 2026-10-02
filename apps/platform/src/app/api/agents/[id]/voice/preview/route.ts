import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isValidUuid } from '@repo/db/validation';
import { resolveVoiceProvider } from '@/lib/voice-providers/resolve';
import { preprocessForTTS, prependV3AudioTags } from '@/lib/tts-preprocess';
import { AGENTS } from '@/lib/agents-data';
import { loadAgentConfig } from '@/lib/agent-loader';
import { createClient } from '@repo/db/server';
import type { VoiceSettings } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { voicePreviewSchema } from '@/lib/schemas/voice.schema';
import { getAuthUserId, getOrgIdForUser } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';

import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

const MAX_TEXT_LENGTH = 5000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'agents.id.voice.preview.post', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (workspaceId && !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    // Permission check — require voice:use (skip when no workspace, e.g. during onboarding;
    // the proxy already enforces authentication)
    if (workspaceId) {
      const permResult = await requirePermission(request, workspaceId, 'voice:use');
      if (permResult instanceof NextResponse) return permResult;
    } else {
      const userId = getAuthUserId(request);
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Workspace-scoped agent lookup with hardcoded fallback
    const agent = workspaceId
      ? await loadAgentConfig(workspaceId, id)
      : (AGENTS.find((a) => a.id === id) ?? null);
    if (!agent || agent.type !== 'ai') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const parsed = await parseBody(request, voicePreviewSchema);
    if (isErrorResponse(parsed)) return parsed;

    const rawText = (parsed.text || `Hi, I'm ${agent.name}. This is my voice.`).slice(
      0,
      MAX_TEXT_LENGTH,
    );
    const previewParams = parsed.params as
      | {
          stability?: number;
          similarity_boost?: number;
          style?: number;
          model_id?: string;
        }
      | undefined;
    const modelId = previewParams?.model_id;
    const text = prependV3AudioTags(preprocessForTTS(rawText), id, modelId);

    // Load voice settings to determine provider
    let voiceSettings: VoiceSettings | null = null;
    try {
      const supabase = await createClient();
      let query = supabase.from('agent_configs').select('voice_settings').eq('agent_id', id);
      if (workspaceId) query = query.eq('workspace_id', workspaceId);
      const { data } = await query.single();
      voiceSettings = (data?.voice_settings as VoiceSettings) ?? null;
    } catch {
      // Use default provider
    }

    // Resolve provider + API key
    const userId = getAuthUserId(request);
    const orgId = userId ? await getOrgIdForUser(userId) : null;

    const { provider, apiKey: providerKey } = await resolveVoiceProvider(
      voiceSettings,
      orgId,
      workspaceId ?? undefined,
      { userId: userId ?? undefined },
    );

    const { audio } = await provider.generateSpeech(
      parsed.voice_id,
      text,
      {
        stability: previewParams?.stability,
        similarity_boost: previewParams?.similarity_boost,
        style: previewParams?.style,
        model_id: modelId,
      },
      providerKey,
    );

    return new NextResponse(audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
