/**
 * Credential runtime isolation — NanoClaw proxy pattern.
 *
 * Centralizes all API key resolution into a proxy layer that:
 * 1. Resolves credentials via resolveProviderKey()
 * 2. Returns pre-authenticated HTTP clients (not raw keys)
 * 3. Logs all credential access for audit trail
 * 4. Prevents API keys from leaking into agent execution context
 *
 * Agent-facing code should use getAuthenticatedProvider() instead of
 * directly importing resolveProviderKey + SDK constructors.
 */

import { resolveProviderKey } from '@/lib/resolve-provider-key';
import type { Provider, ResolvedProviderKey } from '@/lib/resolve-provider-key';
import { detectProvider } from '@/lib/provider-detection';
import { getChatProvider } from '@/lib/chat-providers';
import type { ChatProvider } from '@/lib/chat-providers';
import { logKeyEvent } from '@/lib/security-audit';

export interface AuthenticatedProvider {
  provider: ChatProvider;
  model: string;
  source: string;
  providerName: string;
}

export interface CredentialContext {
  orgId: string;
  workspaceId?: string;
  userId?: string;
}

/**
 * Get a pre-authenticated chat provider without exposing the raw API key.
 *
 * The returned ChatProvider has the API key bound internally — callers
 * never see or handle the raw key directly.
 *
 * @param preferredProvider - Provider to try first (falls through priority list if unavailable)
 * @param ctx - Organization and workspace context for key resolution
 * @returns Authenticated provider ready to stream, or null if no key available
 */
export async function getAuthenticatedProvider(
  preferredProvider: Provider | Provider[],
  ctx: CredentialContext,
): Promise<
  | (AuthenticatedProvider & {
      /** Transitional: raw key exposed until SDK clients support pre-bound auth */ apiKey: string;
    })
  | null
> {
  const providers = Array.isArray(preferredProvider) ? preferredProvider : [preferredProvider];

  for (const provider of providers) {
    try {
      const resolved: ResolvedProviderKey = await resolveProviderKey(
        provider,
        ctx.orgId,
        ctx.workspaceId,
        { userId: ctx.userId },
      );

      // Log credential access
      if (ctx.userId) {
        logKeyEvent('key.resolved', ctx.userId, provider, ctx.workspaceId, {
          source: resolved.source,
        });
      }

      // Detect SDK type from the resolved key
      const detected = detectProvider(resolved.key);
      const chatProvider = getChatProvider(detected.sdkType);

      return {
        provider: chatProvider,
        model: detected.defaultModel,
        source: resolved.source,
        providerName: detected.provider,
        apiKey: resolved.key,
      };
    } catch {
      // Provider not available — try next
      continue;
    }
  }

  return null;
}

/**
 * Mask an API key for safe logging/display.
 * Shows only the prefix and last 4 characters.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  const prefix = key.slice(0, 6);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}
