import type {
  ElevenLabsVoice,
  ElevenLabsSubscription,
  ElevenLabsUsageStats,
  VoiceParams,
} from '@repo/types';
import type { PronunciationRule } from './pronunciation-rules';
import { buildPlsXml } from './pronunciation-rules';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

/** Dictionary locator format used in TTS requests */
export interface DictionaryLocator {
  pronunciation_dictionary_id: string;
  version_id: string;
}
const VOICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let voiceCache: { data: ElevenLabsVoice[]; fetchedAt: number } | null = null;

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  return key;
}

function buildHeaders(apiKey?: string): Record<string, string> {
  return {
    'xi-api-key': apiKey ?? getApiKey(),
    'Content-Type': 'application/json',
  };
}

/** @internal — kept for backward compat with callers that have no BYOK context. */
function headers(): Record<string, string> {
  return buildHeaders();
}

export function invalidateVoiceCache(): void {
  voiceCache = null;
}

export async function listVoices(): Promise<ElevenLabsVoice[]> {
  if (voiceCache && Date.now() - voiceCache.fetchedAt < VOICE_CACHE_TTL_MS) {
    return voiceCache.data;
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs listVoices failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const voices = (data.voices ?? []).map(
    (v: {
      voice_id: string;
      name: string;
      labels: Record<string, string>;
      preview_url: string;
      category?: string;
    }) => ({
      voice_id: v.voice_id,
      name: v.name,
      labels: v.labels ?? {},
      preview_url: v.preview_url ?? '',
      category: v.category ?? 'premade',
    }),
  );

  voiceCache = { data: voices, fetchedAt: Date.now() };
  return voices;
}

export async function getVoice(voiceId: string): Promise<ElevenLabsVoice> {
  const res = await fetch(`${ELEVENLABS_BASE}/voices/${encodeURIComponent(voiceId)}`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs getVoice failed: ${res.status} ${res.statusText}`);
  }
  const v = await res.json();
  return {
    voice_id: v.voice_id,
    name: v.name,
    labels: v.labels ?? {},
    preview_url: v.preview_url ?? '',
    category: v.category ?? 'premade',
  };
}

export async function generateSpeech(
  voiceId: string,
  text: string,
  params: Partial<VoiceParams> = {},
  dictionaryLocators?: DictionaryLocator[],
  apiKey?: string,
): Promise<ArrayBuffer> {
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

  // Text normalization (prefer new field, fall back to deprecated boolean)
  if (params.text_normalization) {
    body.apply_text_normalization = params.text_normalization;
  } else if (params.volume_normalization !== undefined) {
    body.apply_text_normalization = params.volume_normalization ? 'on' : 'off';
  }

  // previous_text/next_text for prosody continuity (v2 models only)
  if (!modelId.startsWith('eleven_v3')) {
    if (params.previous_text) body.previous_text = params.previous_text;
    if (params.next_text) body.next_text = params.next_text;
  }

  if (dictionaryLocators?.length) {
    body.pronunciation_dictionary_locators = dictionaryLocators;
  }

  const res = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${outputFormat}`,
    {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.statusText}`);
  }
  return res.arrayBuffer();
}

/** Response from the with-timestamps endpoint */
export interface TTSTimestampResult {
  audio_base64: string;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

/**
 * Generate speech with character-level timestamps for word highlighting.
 * Uses ElevenLabs' /with-timestamps endpoint.
 */
export async function generateSpeechWithTimestamps(
  voiceId: string,
  text: string,
  params: Partial<VoiceParams> = {},
  dictionaryLocators?: DictionaryLocator[],
  apiKey?: string,
): Promise<TTSTimestampResult> {
  // Use flash model for lowest latency by default
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

  // Text normalization (prefer new field, fall back to deprecated boolean)
  if (params.text_normalization) {
    body.apply_text_normalization = params.text_normalization;
  } else if (params.volume_normalization !== undefined) {
    body.apply_text_normalization = params.volume_normalization ? 'on' : 'off';
  }

  // previous_text/next_text for prosody continuity (v2 models only)
  if (!modelId.startsWith('eleven_v3')) {
    if (params.previous_text) body.previous_text = params.previous_text;
    if (params.next_text) body.next_text = params.next_text;
  }

  if (dictionaryLocators?.length) {
    body.pronunciation_dictionary_locators = dictionaryLocators;
  }

  const res = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${outputFormat}`,
    {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs TTS timestamps failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getSubscription(): Promise<ElevenLabsSubscription> {
  const res = await fetch(`${ELEVENLABS_BASE}/user/subscription`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs getSubscription failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getUsageStats(
  startUnix: number,
  endUnix: number,
): Promise<ElevenLabsUsageStats> {
  const url = new URL(`${ELEVENLABS_BASE}/usage/character-stats`);
  url.searchParams.set('start_unix', String(startUnix));
  url.searchParams.set('end_unix', String(endUnix));
  url.searchParams.set('include_workspace_metrics', 'true');
  const res = await fetch(url.toString(), {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs getUsageStats failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Create a pronunciation dictionary from rules via the ElevenLabs API.
 * Returns the dictionary ID and version ID needed for TTS locators.
 */
export async function createPronunciationDictionary(
  rules: PronunciationRule[],
  name = 'celune-platform-dictionary',
  apiKey?: string,
): Promise<DictionaryLocator> {
  const plsXml = buildPlsXml(rules);
  const blob = new Blob([plsXml], { type: 'application/pls+xml' });

  const formData = new FormData();
  formData.append('name', name);
  formData.append('file', blob, 'dictionary.pls');

  const res = await fetch(`${ELEVENLABS_BASE}/pronunciation-dictionaries/add-from-file`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey ?? getApiKey() },
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(
      `ElevenLabs dictionary creation failed: ${res.status} ${res.statusText} ${errorText}`,
    );
  }

  const data = await res.json();
  return {
    pronunciation_dictionary_id: data.id,
    version_id: data.version_id,
  };
}

export async function cloneVoice(
  name: string,
  description: string,
  audioBuffers: Blob[],
  apiKey?: string,
): Promise<{ voice_id: string; name: string }> {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', description);

  for (const buffer of audioBuffers) {
    formData.append('files', buffer, 'recording.webm');
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey ?? getApiKey() },
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs voice clone failed: ${res.status} ${res.statusText} ${errorText}`);
  }

  const data = await res.json();
  invalidateVoiceCache();

  return { voice_id: data.voice_id, name };
}
