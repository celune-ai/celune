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

/** Convert character-level timestamps to word-level */
function charsToWords(
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  } | null,
): { word: string; start: number; end: number }[] {
  if (!alignment) return [];
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;
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
  if (currentWord) {
    words.push({ word: currentWord, start: wordStart, end: wordEnd });
  }
  return words;
}

/**
 * POST /api/agents/[id]/voice/tts-stream
 * Streams TTS audio chunks + word timestamps as Server-Sent Events.
 *
 * Each SSE event has JSON data:
 *   { audio_base64: string, words: WordTimestamp[], isFinal: boolean }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const rateLimitResult = await applyRateLimit(request, 'agents.voice.tts-stream', RATE_AI);
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
      return new Response(JSON.stringify({ error: 'Agent not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Enforce TTS plan limits
    if (wsId) {
      const planBlocked = await enforcePlanLimit(
        { workspaceId: wsId, userId: getAuthUserId(request) ?? undefined },
        'tts',
      );
      if (planBlocked) return planBlocked;
    }

    const ttsParams: Partial<import('@repo/types').VoiceParams> = {
      ...(parsed.params as Record<string, unknown>),
    };
    const modelId = ttsParams.model_id as string | undefined;
    const rawText = (parsed.text || `Hi, I'm ${agent.name}. This is my voice.`).slice(
      0,
      MAX_TEXT_LENGTH,
    );
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

    const workspaceId = parsed.workspace_id;
    const agentId = id;
    const textLength = rawText.length;
    const capturedKey = providerKey;
    const capturedKeySource = ttsKeySource;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let lastEndSec = 0;
          for await (const chunk of provider.streamSpeech(
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
            capturedKey,
          )) {
            const words = charsToWords(chunk.alignment);
            if (chunk.alignment) {
              const ends = chunk.alignment.character_end_times_seconds;
              if (ends.length > 0) lastEndSec = Math.max(lastEndSec, ends[ends.length - 1]);
            }
            const event = {
              audio_base64: chunk.audio_base64,
              words,
              isFinal: chunk.isFinal,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();

          // Track TTS usage after stream completes
          if (workspaceId) {
            const durationSec = lastEndSec > 0 ? lastEndSec : textLength / 750;
            trackUsage({
              workspace_id: workspaceId,
              event_type: 'tts_minutes',
              quantity: Math.max(durationSec / 60, 0.01),
              unit: 'minutes',
              metadata: {
                agent_id: agentId,
                text_length: textLength,
                key_source: capturedKeySource,
              },
            });
          }
        } catch (error) {
          console.error('[API Error]', error);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'Stream error occurred' })}\n\n`),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
