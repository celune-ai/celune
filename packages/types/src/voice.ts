export type VoiceProvider = 'elevenlabs' | 'openai';

export type ElevenLabsModel =
  'eleven_multilingual_v2' | 'eleven_turbo_v2_5' | 'eleven_flash_v2_5' | 'eleven_v3';

export type AudioOutputFormat = 'mp3_44100_128' | 'pcm_16000' | 'ogg_opus';

export type TextNormalization = 'auto' | 'on' | 'off';

export interface VoiceParams {
  stability: number;
  similarity_boost: number;
  style: number;
  // Advanced (all optional for backward compat)
  speed?: number;
  speaker_boost?: boolean;
  model_id?: ElevenLabsModel;
  output_format?: AudioOutputFormat;
  text_normalization?: TextNormalization;
  /** @deprecated Use `text_normalization` instead. Kept for backward compat with saved settings. */
  volume_normalization?: boolean;
  /** Previous text for prosody continuity (v2 models only) */
  previous_text?: string;
  /** Next text for prosody continuity (v2 models only) */
  next_text?: string;
}

export interface VoiceSettings {
  provider: VoiceProvider;
  voice_id: string;
  voice_name: string;
  params: VoiceParams;
  /** Optional system prompt override for this voice profile (e.g. DROID protocol) */
  system_prompt?: string;
  /** ElevenLabs pronunciation dictionary ID for correct name/brand pronunciation */
  pronunciation_dictionary_id?: string;
  /** Version ID paired with the pronunciation dictionary */
  pronunciation_dictionary_version_id?: string;
  /** How long to wait (ms) after silence before sending transcript (default: 1500) */
  silence_threshold_ms?: number;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  labels: Record<string, string>;
  preview_url: string;
  category?: string;
}

export interface VoiceCloneRequest {
  name: string;
  description?: string;
  files: Blob[];
}

export interface VoiceCloneResponse {
  voice_id: string;
  name: string;
}

// ─── ElevenLabs Analytics ────────────────────────────────────────────────────

export interface ElevenLabsSubscription {
  tier: string;
  character_count: number;
  character_limit: number;
  voice_limit: number;
  voice_slots_used: number;
  professional_voice_limit: number;
  professional_voice_slots_used: number;
  next_character_count_reset_unix: number;
  billing_period: string;
  status: string;
}

export interface ElevenLabsUsageStats {
  time: number[];
  usage: Record<string, number[]>;
}
