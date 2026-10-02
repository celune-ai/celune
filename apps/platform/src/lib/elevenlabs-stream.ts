import type { VoiceParams } from '@repo/types';
import type { DictionaryLocator } from './elevenlabs';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  return key;
}

function resolveApiKey(apiKey?: string): string {
  return apiKey ?? getApiKey();
}

/** A single chunk from ElevenLabs streaming-with-timestamps endpoint */
export interface TTSStreamChunk {
  audio_base64: string;
  isFinal: boolean;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  } | null;
}

/**
 * Stream TTS with character-level timestamps from ElevenLabs.
 * Returns an async iterable of chunks.
 */
export async function* streamSpeechWithTimestamps(
  voiceId: string,
  text: string,
  params: Partial<VoiceParams> = {},
  dictionaryLocators?: DictionaryLocator[],
  apiKey?: string,
): AsyncGenerator<TTSStreamChunk> {
  const modelId = params.model_id ?? 'eleven_flash_v2_5';
  const outputFormat = params.output_format ?? 'mp3_44100_128';

  const voiceSettings: Record<string, unknown> = {
    stability: params.stability ?? 0.4,
    similarity_boost: params.similarity_boost ?? 0.75,
    style: params.style ?? 0.04,
  };

  if (params.speaker_boost !== undefined) {
    voiceSettings.use_speaker_boost = params.speaker_boost;
  }

  const body: Record<string, unknown> = {
    text,
    model_id: modelId,
    voice_settings: voiceSettings,
  };

  if (params.speed !== undefined) {
    body.speed = params.speed;
  }

  if (params.text_normalization) {
    body.apply_text_normalization = params.text_normalization;
  } else if (params.volume_normalization !== undefined) {
    body.apply_text_normalization = params.volume_normalization ? 'on' : 'off';
  }

  if (!modelId.startsWith('eleven_v3')) {
    if (params.previous_text) body.previous_text = params.previous_text;
    if (params.next_text) body.next_text = params.next_text;
  }

  if (dictionaryLocators?.length) {
    body.pronunciation_dictionary_locators = dictionaryLocators;
  }

  const res = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}/stream/with-timestamps?output_format=${outputFormat}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': resolveApiKey(apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs streaming TTS failed: ${res.status} ${res.statusText} ${errText}`);
  }

  if (!res.body) {
    throw new Error('ElevenLabs streaming TTS returned no body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // ElevenLabs sends newline-delimited JSON objects
    const lines = buffer.split('\n');
    // Keep the last incomplete line in buffer
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const chunk = JSON.parse(trimmed) as TTSStreamChunk;
        yield chunk;
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    try {
      const chunk = JSON.parse(buffer.trim()) as TTSStreamChunk;
      yield chunk;
    } catch {
      // Skip malformed trailing data
    }
  }
}
