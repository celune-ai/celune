/**
 * Voice Provider Abstraction Types
 *
 * Provider-agnostic interfaces for TTS generation, streaming, voice listing,
 * and optional features like cloning and pronunciation dictionaries.
 */

// ─── Provider Capabilities ──────────────────────────────────────────────────

export interface ProviderCapabilities {
  /** Supports streaming TTS with chunked delivery */
  streaming: boolean;
  /** Supports voice cloning from audio samples */
  cloning: boolean;
  /** Supports custom pronunciation dictionaries */
  pronunciation: boolean;
  /** Supports SSML input */
  ssml: boolean;
  /** Supports character/word-level timestamp alignment */
  timestamps: boolean;
}

// ─── Shared Voice Representation ────────────────────────────────────────────

/** Provider-agnostic voice entry returned by listVoices */
export interface ProviderVoice {
  voice_id: string;
  name: string;
  /** Provider-specific labels/tags (e.g. accent, gender, age) */
  labels: Record<string, string>;
  /** URL to a short audio preview, if available */
  preview_url: string;
  /** Category: premade, cloned, generated, etc. */
  category: string;
  /** The provider this voice belongs to */
  provider: string;
}

// ─── TTS Result Types ───────────────────────────────────────────────────────

export interface TTSResult {
  /** Raw audio bytes */
  audio: ArrayBuffer;
}

export interface TTSTimestampResult {
  /** Base64-encoded audio */
  audio_base64: string;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

export interface TTSStreamChunk {
  audio_base64: string;
  isFinal: boolean;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  } | null;
}

// ─── Generation Options ─────────────────────────────────────────────────────

export interface TTSOptions {
  /** Voice tuning params (provider interprets what it supports) */
  stability?: number;
  similarity_boost?: number;
  style?: number;
  speed?: number;
  speaker_boost?: boolean;
  /** Provider-specific model ID */
  model_id?: string;
  /** Audio output format */
  output_format?: string;
  /** Text normalization mode */
  text_normalization?: string;
  /** Context for prosody continuity */
  previous_text?: string;
  next_text?: string;
}

/** Pronunciation dictionary locator (provider-specific) */
export interface DictionaryLocator {
  pronunciation_dictionary_id: string;
  version_id: string;
}

// ─── Voice Provider Interface ───────────────────────────────────────────────

export interface VoiceProviderInterface {
  /** Unique provider identifier (e.g. 'elevenlabs', 'openai') */
  readonly name: string;

  /** Human-readable display name */
  readonly displayName: string;

  /** What this provider supports */
  readonly capabilities: ProviderCapabilities;

  /** List available voices for this provider */
  listVoices(apiKey?: string): Promise<ProviderVoice[]>;

  /** Get a single voice by ID */
  getVoice(voiceId: string, apiKey?: string): Promise<ProviderVoice>;

  /** Generate speech audio (non-streaming) */
  generateSpeech(
    voiceId: string,
    text: string,
    options?: TTSOptions,
    apiKey?: string,
  ): Promise<TTSResult>;

  /** Generate speech with character-level timestamps */
  generateSpeechWithTimestamps(
    voiceId: string,
    text: string,
    options?: TTSOptions,
    dictionaryLocators?: DictionaryLocator[],
    apiKey?: string,
  ): Promise<TTSTimestampResult>;

  /** Stream speech with chunked delivery + optional timestamps */
  streamSpeech(
    voiceId: string,
    text: string,
    options?: TTSOptions,
    dictionaryLocators?: DictionaryLocator[],
    apiKey?: string,
  ): AsyncGenerator<TTSStreamChunk>;

  /** Clone a voice from audio samples (requires capabilities.cloning) */
  cloneVoice?(
    name: string,
    description: string,
    audioBuffers: Blob[],
    apiKey?: string,
  ): Promise<{ voice_id: string; name: string }>;

  /** Create a pronunciation dictionary (requires capabilities.pronunciation) */
  createDictionary?(
    rules: Array<{ term: string; pronunciation: string; alphabet?: string }>,
    name?: string,
    apiKey?: string,
  ): Promise<DictionaryLocator>;
}

/** Provider info for UI display (no API key needed) */
export interface VoiceProviderInfo {
  name: string;
  displayName: string;
  capabilities: ProviderCapabilities;
}
