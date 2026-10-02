/**
 * ElevenLabs Voice Provider
 *
 * Wraps the existing elevenlabs.ts functions into the VoiceProviderInterface.
 * Delegates all actual API calls to the original implementation.
 */

import type {
  VoiceProviderInterface,
  ProviderCapabilities,
  ProviderVoice,
  TTSResult,
  TTSTimestampResult,
  TTSStreamChunk,
  TTSOptions,
  DictionaryLocator,
} from '@repo/types';
import type { VoiceParams } from '@repo/types';
import * as elevenlabs from '../elevenlabs';
import { streamSpeechWithTimestamps } from '../elevenlabs-stream';

/** Convert generic TTSOptions to ElevenLabs-specific VoiceParams */
function toVoiceParams(options?: TTSOptions): Partial<VoiceParams> {
  if (!options) return {};
  return {
    stability: options.stability,
    similarity_boost: options.similarity_boost,
    style: options.style,
    speed: options.speed,
    speaker_boost: options.speaker_boost,
    model_id: options.model_id as VoiceParams['model_id'],
    output_format: options.output_format as VoiceParams['output_format'],
    text_normalization: options.text_normalization as VoiceParams['text_normalization'],
    previous_text: options.previous_text,
    next_text: options.next_text,
  };
}

export class ElevenLabsProvider implements VoiceProviderInterface {
  readonly name = 'elevenlabs';
  readonly displayName = 'ElevenLabs';

  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    cloning: true,
    pronunciation: true,
    ssml: false,
    timestamps: true,
  };

  async listVoices(apiKey?: string): Promise<ProviderVoice[]> {
    // listVoices doesn't accept apiKey in original impl — uses env var
    void apiKey;
    const voices = await elevenlabs.listVoices();
    return voices.map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      labels: v.labels,
      preview_url: v.preview_url,
      category: v.category ?? 'premade',
      provider: 'elevenlabs',
    }));
  }

  async getVoice(voiceId: string, apiKey?: string): Promise<ProviderVoice> {
    void apiKey;
    const v = await elevenlabs.getVoice(voiceId);
    return {
      voice_id: v.voice_id,
      name: v.name,
      labels: v.labels,
      preview_url: v.preview_url,
      category: v.category ?? 'premade',
      provider: 'elevenlabs',
    };
  }

  async generateSpeech(
    voiceId: string,
    text: string,
    options?: TTSOptions,
    apiKey?: string,
  ): Promise<TTSResult> {
    const audio = await elevenlabs.generateSpeech(
      voiceId,
      text,
      toVoiceParams(options),
      undefined,
      apiKey,
    );
    return { audio };
  }

  async generateSpeechWithTimestamps(
    voiceId: string,
    text: string,
    options?: TTSOptions,
    dictionaryLocators?: DictionaryLocator[],
    apiKey?: string,
  ): Promise<TTSTimestampResult> {
    return elevenlabs.generateSpeechWithTimestamps(
      voiceId,
      text,
      toVoiceParams(options),
      dictionaryLocators as elevenlabs.DictionaryLocator[],
      apiKey,
    );
  }

  async *streamSpeech(
    voiceId: string,
    text: string,
    options?: TTSOptions,
    dictionaryLocators?: DictionaryLocator[],
    apiKey?: string,
  ): AsyncGenerator<TTSStreamChunk> {
    yield* streamSpeechWithTimestamps(
      voiceId,
      text,
      toVoiceParams(options),
      dictionaryLocators as elevenlabs.DictionaryLocator[],
      apiKey,
    );
  }

  async cloneVoice(
    name: string,
    description: string,
    audioBuffers: Blob[],
    apiKey?: string,
  ): Promise<{ voice_id: string; name: string }> {
    return elevenlabs.cloneVoice(name, description, audioBuffers, apiKey);
  }

  async createDictionary(
    rules: Array<{ term: string; pronunciation: string; alphabet?: string }>,
    name?: string,
    apiKey?: string,
  ): Promise<DictionaryLocator> {
    return elevenlabs.createPronunciationDictionary(rules, name, apiKey);
  }
}
