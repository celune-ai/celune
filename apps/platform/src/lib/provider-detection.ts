/**
 * Auto-detect AI provider from API key prefix.
 *
 * Returns provider metadata (name, SDK type, base URL, default model)
 * from a simple prefix match — no API call needed.
 */

import type { Provider } from '@/lib/resolve-provider-key';

export type SdkType = 'anthropic' | 'openai-compatible' | 'google-gemini';

export interface DetectedProvider {
  /** Internal provider key matching the DB enum */
  provider: Provider;
  /** Human-readable display name */
  displayName: string;
  /** SDK routing type */
  sdkType: SdkType;
  /** Base URL for OpenAI-compatible providers (undefined for Anthropic/Gemini) */
  baseUrl?: string;
  /** Default chat model for this provider */
  defaultModel: string;
}

interface PrefixRule {
  prefix: string;
  result: DetectedProvider;
}

/**
 * Ordered prefix rules — more specific prefixes first.
 * `sk-ant-` must come before `sk-` to avoid false OpenAI match.
 * `sk-or-` must come before `sk-` for OpenRouter.
 */
const PREFIX_RULES: PrefixRule[] = [
  {
    prefix: 'sk-ant-',
    result: {
      provider: 'anthropic',
      displayName: 'Anthropic',
      sdkType: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
    },
  },
  {
    prefix: 'sk-or-',
    result: {
      provider: 'openai',
      displayName: 'OpenRouter',
      sdkType: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'auto',
    },
  },
  {
    prefix: 'gsk_',
    result: {
      provider: 'groq',
      displayName: 'Groq',
      sdkType: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.1-70b-versatile',
    },
  },
  {
    prefix: 'xai-',
    result: {
      provider: 'openai',
      displayName: 'xAI (Grok)',
      sdkType: 'openai-compatible',
      baseUrl: 'https://api.x.ai/v1',
      defaultModel: 'grok-2',
    },
  },
  {
    prefix: 'AIza',
    result: {
      provider: 'google_gemini',
      displayName: 'Google Gemini',
      sdkType: 'google-gemini',
      defaultModel: 'gemini-2.0-flash',
    },
  },
  {
    // Generic sk- after more specific prefixes
    prefix: 'sk-',
    result: {
      provider: 'openai',
      displayName: 'OpenAI',
      sdkType: 'openai-compatible',
      defaultModel: 'gpt-4o',
    },
  },
];

/** Fallback for unrecognized key formats — tries OpenAI-compatible. */
const UNKNOWN_PROVIDER: DetectedProvider = {
  provider: 'openai',
  displayName: 'Unknown Provider',
  sdkType: 'openai-compatible',
  defaultModel: 'gpt-4o',
};

/**
 * Detect AI provider from API key prefix.
 * Instant string match — no API call.
 */
export function detectProvider(key: string): DetectedProvider {
  if (!key || key.length < 3) return UNKNOWN_PROVIDER;

  for (const rule of PREFIX_RULES) {
    if (key.startsWith(rule.prefix)) {
      return rule.result;
    }
  }

  return UNKNOWN_PROVIDER;
}

/** Check if detection returned a known provider (not fallback). */
export function isKnownProvider(detected: DetectedProvider): boolean {
  return detected.displayName !== 'Unknown Provider';
}
