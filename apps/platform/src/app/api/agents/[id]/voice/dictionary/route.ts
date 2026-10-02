import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createActivity } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import { PRONUNCIATION_RULES } from '@/lib/pronunciation-rules';
import { resolveVoiceProvider } from '@/lib/voice-providers/resolve';
import { AGENTS } from '@/lib/agents-data';
import { loadAgentConfig } from '@/lib/agent-loader';
import type { VoiceSettings } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId, getOrgIdForUser } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';

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

/**
 * GET /api/agents/[id]/voice/dictionary?workspace_id=xxx
 * Returns the current pronunciation dictionary locator for an agent.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (workspaceId && !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    // Permission check — require agents:read for dictionary lookup
    const permResult = await requirePermission(request, workspaceId ?? null, 'agents:read');
    if (permResult instanceof NextResponse) return permResult;
    const agent = await resolveAgent(id, workspaceId);
    if (!agent || agent.type !== 'ai') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const supabase = await createClient();
    let query = supabase.from('agent_configs').select('voice_settings').eq('agent_id', id);
    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { data, error } = await query.single();

    if (error) throw error;

    const vs = data?.voice_settings as VoiceSettings | null;
    return NextResponse.json({
      pronunciation_dictionary_id: vs?.pronunciation_dictionary_id ?? null,
      pronunciation_dictionary_version_id: vs?.pronunciation_dictionary_version_id ?? null,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/agents/[id]/voice/dictionary?workspace_id=xxx
 * Creates/updates the pronunciation dictionary for an agent via the voice provider,
 * then stores the dictionary + version IDs in voice_settings.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(
    request,
    'agents.id.voice.dictionary.post',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (workspaceId && !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    // Permission check — require agents:configure for dictionary updates
    const permResult = await requirePermission(request, workspaceId ?? null, 'agents:configure');
    if (permResult instanceof NextResponse) return permResult;
    const agent = await resolveAgent(id, workspaceId);
    if (!agent || agent.type !== 'ai') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const supabase = await createClient();

    // Get current voice settings
    let configQuery = supabase.from('agent_configs').select('voice_settings').eq('agent_id', id);
    if (workspaceId) {
      configQuery = configQuery.eq('workspace_id', workspaceId);
    }

    const { data: configData } = await configQuery.single();

    const currentVs = (configData?.voice_settings as VoiceSettings | null) ?? null;
    if (!currentVs) {
      return NextResponse.json(
        { error: 'Agent has no voice settings configured. Set up voice first.' },
        { status: 400 },
      );
    }

    // Resolve provider + API key
    const userId = getAuthUserId(request);
    const orgId = userId ? await getOrgIdForUser(userId) : null;

    const { provider, apiKey: providerKey } = await resolveVoiceProvider(
      currentVs,
      orgId,
      undefined,
      { userId: userId ?? undefined },
    );

    // Check if provider supports pronunciation dictionaries
    if (!provider.capabilities.pronunciation || !provider.createDictionary) {
      return NextResponse.json(
        { error: `Pronunciation dictionaries are not supported by ${provider.displayName}` },
        { status: 400 },
      );
    }

    // Create dictionary via provider API
    const locator = await provider.createDictionary(
      PRONUNCIATION_RULES,
      `${agent.name}-pronunciation`,
      providerKey,
    );

    // Update voice settings with dictionary IDs
    const updatedVs: VoiceSettings = {
      ...currentVs,
      pronunciation_dictionary_id: locator.pronunciation_dictionary_id,
      pronunciation_dictionary_version_id: locator.version_id,
    };

    let updateQuery = supabase
      .from('agent_configs')
      .update({ voice_settings: updatedVs })
      .eq('agent_id', id);
    if (workspaceId) {
      updateQuery = updateQuery.eq('workspace_id', workspaceId);
    }

    const { error } = await updateQuery;

    if (error) throw error;

    await createActivity(supabase, {
      event_type: 'agent.dictionary_updated',
      severity: 'info',
      source: 'web',
      title: `Pronunciation dictionary set for ${agent.name}`,
      agent_id: id,
    });

    return NextResponse.json({
      pronunciation_dictionary_id: locator.pronunciation_dictionary_id,
      pronunciation_dictionary_version_id: locator.version_id,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
