import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveVoiceProvider } from '@/lib/voice-providers/resolve';
import type { DictionaryLocator } from '@repo/types';
import { preprocessForTTS, prependV3AudioTags } from '@/lib/tts-preprocess';
import { AGENTS } from '@/lib/agents-data';
import { loadAgentConfig } from '@/lib/agent-loader';
import { createClient } from '@repo/db/server';
import type { VoiceSettings } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { ttsRequestSchema } from '@/lib/schemas/voice.schema';
import { trackUsage } from '@/lib/track-usage';
import { enforcePlanLimit } from '@/lib/plan-enforcement';
import { getAuthUserId, getOrgIdForWorkspace, getOrgIdForUser } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const MAX_TEXT_LENGTH = 5000;

/**
 * POST /api/agents/[id]/voice/tts
 * Returns JSON with base64 audio + character-level timestamps for word highlighting.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const rateLimitResult = await applyRateLimit(request, 'agents.voice.tts', RATE_AI);
    if (rateLimitResult) return rateLimitResult.blocked;

    const { id } = await params;

    const parsed = await parseBody(request, ttsRequestSchema);
    if (isErrorResponse(parsed)) return parsed;

    const wsId = parsed.workspace_id ?? null;

    // Permission check — require voice:use
    const permResult = await requirePermission(request, wsId, 'voice:use');
    if (permResult instanceof NextResponse) return permResult;

    // Workspace-scoped agent lookup with hardcoded fallback
    const agent = wsId
      ? await loadAgentConfig(wsId, id)
      : (AGENTS.find((a) => a.id === id) ?? null);
    if (!agent || agent.type !== 'ai') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Enforce TTS plan limits
    if (wsId) {
      const planBlocked = await enforcePlanLimit(
        { workspaceId: wsId, userId: getAuthUserId(request) ?? undefined },
        'tts',
      );
      if (planBlocked) return planBlocked;
    }

    const rawText = (parsed.text || `Hi, I'm ${agent.name}. This is my voice.`).slice(
      0,
      MAX_TEXT_LENGTH,
    );
    const ttsParams: Partial<import('@repo/types').VoiceParams> = {
      ...(parsed.params as Record<string, unknown>),
    };
    const modelId = ttsParams.model_id as string | undefined;
    const text = prependV3AudioTags(preprocessForTTS(rawText), id, modelId);
    if (parsed.previous_text) ttsParams.previous_text = parsed.previous_text;

    // Load voice settings for dictionary + provider resolution
    let voiceSettings: VoiceSettings | null = null;
    let dictionaryLocators: DictionaryLocator[] | undefined;
    try {
      const supabase = await createClient();
      let dictQuery = supabase.from('agent_configs').select('voice_settings').eq('agent_id', id);
      if (wsId) {
        dictQuery = dictQuery.eq('workspace_id', wsId);
      }
      const { data: configRow } = await dictQuery.single();
      voiceSettings = (configRow?.voice_settings as VoiceSettings) ?? null;
      if (
        voiceSettings?.pronunciation_dictionary_id &&
        voiceSettings?.pronunciation_dictionary_version_id
      ) {
        dictionaryLocators = [
          {
            pronunciation_dictionary_id: voiceSettings.pronunciation_dictionary_id,
            version_id: voiceSettings.pronunciation_dictionary_version_id,
          },
        ];
      }
    } catch {
      // Proceed without dictionary
    }

    // Resolve provider + API key from agent voice settings
    const userId = getAuthUserId(request);
    let orgId: string | null = null;
    if (parsed.workspace_id) {
      orgId = await getOrgIdForWorkspace(parsed.workspace_id);
    } else if (userId) {
      orgId = await getOrgIdForUser(userId);
    }

    const {
      provider,
      apiKey: providerKey,
      keySource: ttsKeySource,
    } = await resolveVoiceProvider(voiceSettings, orgId, parsed.workspace_id ?? undefined, {
      userId: userId ?? undefined,
    });

    const result = await provider.generateSpeechWithTimestamps(
      parsed.voice_id,
      text,
      {
        stability: ttsParams.stability,
        similarity_boost: ttsParams.similarity_boost,
        style: ttsParams.style,
        speed: ttsParams.speed,
        speaker_boost: ttsParams.speaker_boost,
        model_id: ttsParams.model_id,
        output_format: ttsParams.output_format,
        text_normalization: ttsParams.text_normalization,
        previous_text: ttsParams.previous_text,
        next_text: ttsParams.next_text,
      },
      dictionaryLocators,
      providerKey,
    );

    // Convert character-level timestamps to word-level for the client
    const { characters, character_start_times_seconds, character_end_times_seconds } =
      result.alignment;

    const words: { word: string; start: number; end: number }[] = [];
    let currentWord = '';
    let wordStart = -1;
    let wordEnd = 0;

    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      const start = character_start_times_seconds[i];
      const end = character_end_times_seconds[i];

      if (char === ' ' || char === '\n' || char === '\t') {
        if (currentWord) {
          words.push({ word: currentWord, start: wordStart, end: wordEnd });
          currentWord = '';
          wordStart = -1;
        }
      } else {
        if (wordStart === -1) wordStart = start;
        currentWord += char;
        wordEnd = end;
      }
    }
    // Push last word
    if (currentWord) {
      words.push({ word: currentWord, start: wordStart, end: wordEnd });
    }

    // Track TTS usage (estimate minutes from audio duration)
    if (parsed.workspace_id) {
      const durationSec =
        character_end_times_seconds.length > 0
          ? character_end_times_seconds[character_end_times_seconds.length - 1]
          : rawText.length / 750; // fallback: ~750 chars/min
      trackUsage({
        workspace_id: parsed.workspace_id,
        event_type: 'tts_minutes',
        quantity: Math.max(durationSec / 60, 0.01),
        unit: 'minutes',
        metadata: { agent_id: id, text_length: rawText.length, key_source: ttsKeySource },
      });
    }

    return NextResponse.json({
      audio_base64: result.audio_base64,
      words,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
