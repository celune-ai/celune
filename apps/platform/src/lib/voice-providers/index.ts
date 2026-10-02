/**
 * Voice Provider Registry
 *
 * Central registry for voice/TTS providers. Import getProvider() or
 * listProviders() to work with voice providers generically.
 *
 * Adding a new provider:
 *   1. Create provider file (e.g. google-tts.ts) implementing VoiceProviderInterface
 *   2. Import and register it in the PROVIDERS map below
 */

import type { VoiceProviderInterface, VoiceProviderInfo } from '@repo/types';

// Provider implementations (lazy imports prevent unused providers from loading)
import { ElevenLabsProvider } from './elevenlabs';
import { OpenAITTSProvider } from './openai-tts';

// ─── Provider Registry ──────────────────────────────────────────────────────

const PROVIDERS: Record<string, VoiceProviderInterface> = {
  elevenlabs: new ElevenLabsProvider(),
  openai: new OpenAITTSProvider(),
};

/**
 * Get a provider instance by name.
 * @throws Error if provider is not registered
 */
export function getProvider(name: string): VoiceProviderInterface {
  const provider = PROVIDERS[name];
  if (!provider) {
    const available = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown voice provider "${name}". Available: ${available}`);
  }
  return provider;
}

/** List all registered providers with their capabilities (no API key needed). */
export function listProviders(): VoiceProviderInfo[] {
  return Object.values(PROVIDERS).map((p) => ({
    name: p.name,
    displayName: p.displayName,
    capabilities: p.capabilities,
  }));
}

/** Check if a provider name is valid. */
export function isValidProvider(name: string): boolean {
  return name in PROVIDERS;
}

export { ElevenLabsProvider } from './elevenlabs';
export { OpenAITTSProvider } from './openai-tts';
