import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createActivity } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import { getProvider, listProviders } from '@/lib/voice-providers';
import { AGENTS } from '@/lib/agents-data';
import { loadAgentConfig } from '@/lib/agent-loader';
import type { VoiceSettings } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { voiceSettingsSchema } from '@/lib/schemas/voice.schema';
import { validateOrigin } from '@/lib/csrf';
import { isAgentEmployed } from '@/lib/agent-employment';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/**
 * Resolve agent by ID, checking workspace-scoped configs first if workspace_id provided.
 */
async function resolveAgent(
  id: string,
  workspaceId: string | null,
): Promise<{ name: string; type: string } | null> {
  if (workspaceId) {
    const agent = await loadAgentConfig(workspaceId, id);
    return agent ? { name: agent.name, type: agent.type } : null;
  }
  const agent = AGENTS.find((a) => a.id === id);
  return agent ? { name: agent.name, type: agent.type } : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (workspaceId && !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }
    const agent = await resolveAgent(id, workspaceId);
    if (!agent || agent.type !== 'ai') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Check agent is employed in this workspace
    if (workspaceId) {
      const employed = await isAgentEmployed(workspaceId, id);
      if (!employed) {
        return NextResponse.json(
          { error: `Agent "${id}" is not employed in this workspace` },
          { status: 403 },
        );
      }
    }

    const supabase = await createClient();

    let configQuery = supabase.from('agent_configs').select('voice_settings').eq('agent_id', id);
    if (workspaceId) {
      configQuery = configQuery.eq('workspace_id', workspaceId);
    }

    const { data: configData } = await configQuery.single();
    const currentSettings = configData?.voice_settings as
      import('@repo/types').VoiceSettings | null;
    // Allow override via query param (for UI provider switching)
    const providerOverride = request.nextUrl.searchParams.get('provider');
    const providerName = providerOverride ?? currentSettings?.provider ?? 'elevenlabs';

    const provider = getProvider(providerName);
    const voices = await provider.listVoices();

    // Sort: user's custom/cloned voices first, then premade
    const sorted = [...voices].sort((a, b) => {
      const aCustom = a.category !== 'premade' ? 0 : 1;
      const bCustom = b.category !== 'premade' ? 0 : 1;
      return aCustom - bCustom;
    });

    return NextResponse.json({
      voices: sorted,
      current: currentSettings,
      providers: listProviders(),
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'agents.id.voice.put', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (workspaceId && !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }
    const agent = await resolveAgent(id, workspaceId);
    if (!agent || agent.type !== 'ai') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Check agent is employed before allowing voice config updates
    if (workspaceId) {
      const employed = await isAgentEmployed(workspaceId, id);
      if (!employed) {
        return NextResponse.json(
          { error: `Agent "${id}" is not employed in this workspace` },
          { status: 403 },
        );
      }
    }

    const parsed = await parseBody(request, voiceSettingsSchema);
    if (isErrorResponse(parsed)) return parsed;

    const voiceSettings: VoiceSettings = {
      provider: parsed.provider,
      voice_id: parsed.voice_id,
      voice_name: parsed.voice_name,
      params: {
        stability: Math.max(0, Math.min(1, parsed.params?.stability ?? 0.5)),
        similarity_boost: Math.max(0, Math.min(1, parsed.params?.similarity_boost ?? 0.75)),
        style: Math.max(0, Math.min(1, parsed.params?.style ?? 0)),
        ...(parsed.params?.speed !== undefined && {
          speed: Math.max(0.5, Math.min(2, parsed.params.speed)),
        }),
        ...(parsed.params?.speaker_boost !== undefined && {
          speaker_boost: parsed.params.speaker_boost,
        }),
        ...(parsed.params?.model_id && { model_id: parsed.params.model_id }),
        ...(parsed.params?.output_format && { output_format: parsed.params.output_format }),
        ...(parsed.params?.text_normalization && {
          text_normalization: parsed.params.text_normalization,
        }),
        ...(parsed.params?.volume_normalization !== undefined && {
          volume_normalization: parsed.params.volume_normalization,
        }),
      },
      ...(parsed.system_prompt !== undefined && { system_prompt: parsed.system_prompt }),
    };

    const supabase = await createClient();
    const upsertPayload: Record<string, unknown> = {
      agent_id: id,
      voice_settings: voiceSettings,
    };
    if (workspaceId) {
      upsertPayload.workspace_id = workspaceId;
    }

    const { data, error } = await supabase
      .from('agent_configs')
      .upsert(upsertPayload)
      .select('voice_settings')
      .single();

    if (error) throw error;

    await createActivity(supabase, {
      event_type: 'agent.voice_updated',
      severity: 'info',
      source: 'web',
      title: `Voice updated: ${agent.name} → ${voiceSettings.voice_name}`,
      agent_id: id,
    });

    return NextResponse.json(data);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
