import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createActivity } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import { invalidateVoiceCache } from '@/lib/elevenlabs';
import { resolveVoiceProvider } from '@/lib/voice-providers/resolve';
import { AGENTS } from '@/lib/agents-data';
import { loadAgentConfig } from '@/lib/agent-loader';
import type { VoiceSettings } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId, getOrgIdForUser } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';

import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'agents.id.voice.clone.post', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (workspaceId && !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    // Permission check — require agents:configure for voice cloning
    const permResult = await requirePermission(request, workspaceId ?? null, 'agents:configure');
    if (permResult instanceof NextResponse) return permResult;

    // Resolve agent: workspace-scoped or hardcoded fallback
    const agent = workspaceId
      ? await loadAgentConfig(workspaceId, id)
      : (AGENTS.find((a) => a.id === id) ?? null);
    if (!agent || agent.type !== 'ai') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const name = formData.get('name');
    const description = (formData.get('description') as string) ?? '';

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const files = formData.getAll('files');
    if (files.length === 0) {
      return NextResponse.json({ error: 'At least one audio file is required' }, { status: 400 });
    }

    // Filter to only Blob/File entries (skip strings)
    const audioBlobs: Blob[] = [];
    for (const f of files) {
      if (typeof f !== 'string') {
        audioBlobs.push(f as Blob);
      }
    }
    if (audioBlobs.length === 0) {
      return NextResponse.json({ error: 'Invalid file data' }, { status: 400 });
    }

    // Load voice settings to determine provider
    const supabase = await createClient();
    let voiceSettings: VoiceSettings | null = null;
    try {
      let vsQuery = supabase.from('agent_configs').select('voice_settings').eq('agent_id', id);
      if (workspaceId) vsQuery = vsQuery.eq('workspace_id', workspaceId);
      const { data: vsData } = await vsQuery.single();
      voiceSettings = (vsData?.voice_settings as VoiceSettings) ?? null;
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

    // Check if provider supports cloning
    if (!provider.capabilities.cloning || !provider.cloneVoice) {
      return NextResponse.json(
        { error: `Voice cloning is not supported by ${provider.displayName}` },
        { status: 400 },
      );
    }

    const result = await provider.cloneVoice(name, description, audioBlobs, providerKey);
    invalidateVoiceCache();

    // Save as agent's voice
    const newVoiceSettings = {
      provider: provider.name as 'elevenlabs' | 'openai',
      voice_id: result.voice_id,
      voice_name: result.name,
      params: { stability: 0.5, similarity_boost: 0.75, style: 0 },
    };

    const upsertPayload: Record<string, unknown> = {
      agent_id: id,
      voice_settings: newVoiceSettings,
    };
    if (workspaceId) {
      upsertPayload.workspace_id = workspaceId;
    }

    await supabase.from('agent_configs').upsert(upsertPayload).select('voice_settings').single();

    await createActivity(supabase, {
      event_type: 'agent.voice_cloned',
      severity: 'info',
      source: 'web',
      title: `Voice cloned: ${agent.name} → ${result.name}`,
      agent_id: id,
    });

    return NextResponse.json({
      voice_id: result.voice_id,
      name: result.name,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
