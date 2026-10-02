/**
 * Resolve the voice provider + API key for a given agent's settings.
 *
 * Reads the provider from voice_settings, resolves the API key via BYOK chain,
 * and returns both the provider instance and key.
 */

import type { VoiceSettings } from '@repo/types';
import type { VoiceProviderInterface } from '@repo/types';
import { getProvider } from './index';
import {
  resolveProviderKey,
  ProviderKeyRequiredError,
  type Provider,
} from '@/lib/resolve-provider-key';

/** Map voice provider names to BYOK provider names */
const PROVIDER_KEY_MAP: Record<string, Provider> = {
  elevenlabs: 'elevenlabs',
  openai: 'openai',
};

export interface ResolvedVoiceProvider {
  provider: VoiceProviderInterface;
  apiKey: string | undefined;
  keySource: 'plan' | 'byok';
}

/**
 * Resolve the voice provider and API key from agent settings.
 *
 * @param voiceSettings - The agent's voice_settings from DB (or null)
 * @param orgId - The org ID for BYOK resolution
 * @param workspaceId - Optional workspace for workspace-scoped keys
 * @returns Provider instance + resolved API key
 */
export async function resolveVoiceProvider(
  voiceSettings: VoiceSettings | null,
  orgId: string | null,
  workspaceId?: string,
  opts?: { userId?: string },
): Promise<ResolvedVoiceProvider> {
  const providerName = voiceSettings?.provider ?? 'elevenlabs';
  const provider = getProvider(providerName);

  let apiKey: string | undefined;
  let keySource: 'plan' | 'byok' = 'plan';

  const byokProvider = PROVIDER_KEY_MAP[providerName];
  if (orgId && byokProvider) {
    try {
      const resolved = await resolveProviderKey(
        byokProvider,
        orgId,
        workspaceId,
        opts ? { userId: opts.userId } : undefined,
      );
      apiKey = resolved.key;
      keySource = resolved.source === 'platform' ? 'plan' : 'byok';
    } catch (err) {
      // Re-throw BYOK gate errors so callers can show the right UI
      if (err instanceof ProviderKeyRequiredError) throw err;
      console.warn(
        '[resolveVoiceProvider] BYOK key resolution failed, using platform default:',
        err,
      );
    }
  }

  return { provider, apiKey, keySource };
}
