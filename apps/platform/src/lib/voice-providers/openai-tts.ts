/**
 * OpenAI TTS Voice Provider
 *
 * Implements VoiceProviderInterface using OpenAI's /v1/audio/speech endpoint.
 * Supports tts-1 and tts-1-hd models with 6 built-in voices.
 */

import type {
  VoiceProviderInterface,
  ProviderCapabilities,
  ProviderVoice,
  TTSResult,
  TTSTimestampResult,
  TTSStreamChunk,
  TTSOptions,
} from '@repo/types';

const OPENAI_BASE = 'https://api.openai.com/v1';

/** OpenAI's 6 built-in TTS voices */
const OPENAI_VOICES: ProviderVoice[] = [
  {
    voice_id: 'alloy',
    name: 'Alloy',
    labels: { gender: 'neutral', tone: 'balanced' },
    preview_url: '',
    category: 'premade',
    provider: 'openai',
  },
  {
    voice_id: 'ash',
    name: 'Ash',
    labels: { gender: 'male', tone: 'warm' },
    preview_url: '',
    category: 'premade',
    provider: 'openai',
  },
  {
    voice_id: 'coral',
    name: 'Coral',
    labels: { gender: 'female', tone: 'warm' },
    preview_url: '',
    category: 'premade',
    provider: 'openai',
  },
  {
    voice_id: 'echo',
    name: 'Echo',
    labels: { gender: 'male', tone: 'deep' },
    preview_url: '',
    category: 'premade',
    provider: 'openai',
  },
  {
    voice_id: 'fable',
    name: 'Fable',
    labels: { gender: 'neutral', tone: 'expressive' },
    preview_url: '',
    category: 'premade',
    provider: 'openai',
  },
  {
    voice_id: 'nova',
    name: 'Nova',
    labels: { gender: 'female', tone: 'friendly' },
    preview_url: '',
    category: 'premade',
    provider: 'openai',
  },
  {
    voice_id: 'onyx',
    name: 'Onyx',
    labels: { gender: 'male', tone: 'authoritative' },
    preview_url: '',
    category: 'premade',
    provider: 'openai',
  },
  {
    voice_id: 'sage',
    name: 'Sage',
    labels: { gender: 'female', tone: 'calm' },
    preview_url: '',
    category: 'premade',
    provider: 'openai',
  },
  {
    voice_id: 'shimmer',
    name: 'Shimmer',
    labels: { gender: 'female', tone: 'bright' },
    preview_url: '',
    category: 'premade',
    provider: 'openai',
  },
];

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  return key;
}

function resolveKey(apiKey?: string): string {
  return apiKey ?? getApiKey();
}

export class OpenAITTSProvider implements VoiceProviderInterface {
  readonly name = 'openai';
  readonly displayName = 'OpenAI TTS';

  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    cloning: false,
    pronunciation: false,
    ssml: false,
    timestamps: false,
  };

  async listVoices(): Promise<ProviderVoice[]> {
    return OPENAI_VOICES;
  }

  async getVoice(voiceId: string): Promise<ProviderVoice> {
    const voice = OPENAI_VOICES.find((v) => v.voice_id === voiceId);
    if (!voice) throw new Error(`OpenAI voice "${voiceId}" not found`);
    return voice;
  }

  async generateSpeech(
    voiceId: string,
    text: string,
    options?: TTSOptions,
    apiKey?: string,
  ): Promise<TTSResult> {
    const model = options?.model_id ?? 'tts-1';
    const speed = options?.speed ?? 1.0;
    const format = options?.output_format ?? 'mp3';

    const res = await fetch(`${OPENAI_BASE}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolveKey(apiKey)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice: voiceId,
        response_format: format,
        speed: Math.max(0.25, Math.min(4.0, speed)),
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI TTS failed: ${res.status} ${res.statusText} ${errText}`);
    }

    return { audio: await res.arrayBuffer() };
  }

  async generateSpeechWithTimestamps(
    voiceId: string,
    text: string,
    options?: TTSOptions,
    _dictionaryLocators?: unknown,
    apiKey?: string,
  ): Promise<TTSTimestampResult> {
    // OpenAI doesn't support timestamps — generate audio and return empty alignment
    const { audio } = await this.generateSpeech(voiceId, text, options, apiKey);
    const base64 = Buffer.from(audio).toString('base64');
    return {
      audio_base64: base64,
      alignment: {
        characters: [],
        character_start_times_seconds: [],
        character_end_times_seconds: [],
      },
    };
  }

  async *streamSpeech(
    voiceId: string,
    text: string,
    options?: TTSOptions,
    _dictionaryLocators?: unknown,
    apiKey?: string,
  ): AsyncGenerator<TTSStreamChunk> {
    const model = options?.model_id ?? 'tts-1';
    const speed = options?.speed ?? 1.0;
    const format = options?.output_format ?? 'mp3';

    const res = await fetch(`${OPENAI_BASE}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolveKey(apiKey)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice: voiceId,
        response_format: format,
        speed: Math.max(0.25, Math.min(4.0, speed)),
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI TTS stream failed: ${res.status} ${res.statusText} ${errText}`);
    }

    if (!res.body) {
      throw new Error('OpenAI TTS returned no body');
    }

    // OpenAI returns the full audio in one response, but we stream the bytes
    const reader = res.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const base64 = Buffer.from(value).toString('base64');
      yield {
        audio_base64: base64,
        isFinal: false,
        alignment: null,
      };
    }

    // Send final marker
    yield { audio_base64: '', isFinal: true, alignment: null };
  }

  // cloneVoice and createDictionary intentionally not implemented — capabilities.cloning = false
}
