/**
 * Provider key fallback chain resolver.
 *
 * Resolves which API key to use for a given provider by checking:
 *   1. Workspace-specific user key (if workspaceId provided)
 *   2. Org-wide user key
 *   3. Host-provided environment variable, cloud edition only, behind the Gate
 *
 * The community edition stops after step 2: a self-host runs on BYOK keys only.
 * Every call first passes the workspace AI budget (assertWorkspaceAiBudget).
 *
 * Server-side only — never import this in client components.
 */

import { createScope, type Gate } from '@celuneai/core';
import { createServiceClient } from '@repo/db/service';
import { decryptProviderKey } from '@/lib/provider-key-crypto';
import { isPlatformOwner } from '@/lib/plan-enforcement';
import { hostConfig } from '@/lib/host-config';
import { createPlatformGate } from '@/lib/gate';
import { assertWorkspaceAiBudget } from '@/lib/ai-budget';

/** Supported provider names — must match the CHECK constraint in the DB schema. */
export type Provider = 'anthropic' | 'openai' | 'elevenlabs' | 'groq' | 'google_gemini' | 'mistral';

/** Indicates where the resolved key came from. */
export type KeySource = 'user_workspace' | 'user_org' | 'platform' | 'trial';

export interface ResolvedProviderKey {
  /** The decrypted API key, ready for use. */
  key: string;
  /** Where the key came from in the fallback chain. */
  source: KeySource;
  /** The provider_api_keys row id, present when source is not 'platform'. */
  keyId?: string;
}

/**
 * Error thrown when no BYOK key is configured and the trial budget is exhausted.
 * Callers should catch this and return a user-friendly response directing them
 * to configure their API key.
 */
export class ProviderKeyRequiredError extends Error {
  public readonly trialExhausted: boolean;
  public readonly provider: Provider;
  /** Gate reason when the host key was denied, for example `trial_exhausted` or `workspace_suspended`. */
  public readonly reason?: string;

  constructor(provider: Provider, trialExhausted: boolean, reason?: string) {
    super(
      trialExhausted
        ? `Starter token budget used up. Please add your own ${provider} API key to continue.`
        : `No ${provider} API key configured. Please add your API key in Settings → Integrations.`,
    );
    this.name = 'ProviderKeyRequiredError';
    this.provider = provider;
    this.trialExhausted = trialExhausted;
    this.reason = reason;
  }
}

/** Whether this host may hand out its own provider keys when a workspace has none. */
export function hostFallbackKeysEnabled(): boolean {
  return hostConfig.edition === 'cloud';
}

/** Maps provider names to their platform environment variable names. */
const PROVIDER_ENV_VARS: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  groq: 'GROQ_API_KEY',
  google_gemini: 'GOOGLE_GEMINI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

/**
 * Resolve which API key to use for a given provider.
 *
 * Lookup order:
 *   1. Workspace-specific active key (requires workspaceId)
 *   2. Org-wide active key (workspace_id IS NULL)
 *   3. Host environment variable (cloud edition only, Gate feature provider.fallback_key)
 *
 * Decryption errors are caught silently so the caller falls through to the
 * next step rather than throwing.
 *
 * @param provider   - The AI provider identifier
 * @param orgId      - The organization id to scope the lookup
 * @param workspaceId - Optional workspace id; enables workspace-specific key lookup and budget checks
 * @param opts       - Optional: userId for platform owner check, skipByokGate to bypass, gate override for tests
 * @returns ResolvedProviderKey with the decrypted key, its source, and optional row id
 * @throws AiBudgetExceededError when the workspace is over its AI budget
 * @throws ProviderKeyRequiredError if no BYOK key and no host key may be used
 * @throws Error if the cloud edition has no host key configured for the provider
 */
export async function resolveProviderKey(
  provider: Provider,
  orgId: string,
  workspaceId?: string,
  opts?: { userId?: string; skipByokGate?: boolean; gate?: Gate },
): Promise<ResolvedProviderKey> {
  if (workspaceId) await assertWorkspaceAiBudget(workspaceId);

  // Service client: resolve provider API key. Accesses: provider_api_keys.
  const supabase = createServiceClient();

  // Step 1: Try workspace-specific key if a workspaceId was supplied.
  if (workspaceId) {
    const { data: wsRow, error: wsError } = await supabase
      .from('provider_api_keys')
      .select('id, encrypted_key, key_iv')
      .eq('org_id', orgId)
      .eq('workspace_id', workspaceId)
      .eq('provider', provider)
      .eq('is_active', true)
      .maybeSingle();

    if (!wsError && wsRow) {
      try {
        const key = decryptProviderKey(wsRow.encrypted_key, wsRow.key_iv);
        touchLastUsed(supabase, wsRow.id);
        return { key, source: 'user_workspace', keyId: wsRow.id };
      } catch {
        // Decryption failed (tampered data or wrong master key) — fall through.
      }
    }
  }

  // Step 2: Try org-wide key (workspace_id IS NULL).
  const { data: orgRow, error: orgError } = await supabase
    .from('provider_api_keys')
    .select('id, encrypted_key, key_iv')
    .eq('org_id', orgId)
    .is('workspace_id', null)
    .eq('provider', provider)
    .eq('is_active', true)
    .maybeSingle();

  if (!orgError && orgRow) {
    try {
      const key = decryptProviderKey(orgRow.encrypted_key, orgRow.key_iv);
      touchLastUsed(supabase, orgRow.id);
      return { key, source: 'user_org', keyId: orgRow.id };
    } catch {
      // Decryption failed — fall through to platform key.
    }
  }

  // Step 3: host-provided key. The community edition has none, so BYOK is required.
  if (!hostFallbackKeysEnabled()) {
    throw new ProviderKeyRequiredError(provider, false);
  }

  const envVarName = PROVIDER_ENV_VARS[provider];
  const platformKey = process.env[envVarName];

  if (!platformKey) {
    throw new Error(
      `No API key available for provider "${provider}". ` +
        `Set ${envVarName} or add a BYOK key for org ${orgId}.`,
    );
  }

  // Platform owner (app creator) always gets platform key — they own the tokens.
  if (opts?.userId && (await isPlatformOwner(opts.userId))) {
    return { key: platformKey, source: 'platform' };
  }

  // Explicitly bypass the gate (e.g. onboarding system messages before key setup)
  if (opts?.skipByokGate) {
    return { key: platformKey, source: 'platform' };
  }

  // Everyone else: the Gate decides (suspension, then trial budget on the cloud gate).
  if (workspaceId) {
    const gate = opts?.gate ?? createPlatformGate();
    const result = await gate.check('provider.fallback_key', {
      scope: createScope({ workspaceId, orgId, actorId: opts?.userId ?? null }),
      userId: opts?.userId ?? null,
    });
    if (result.allowed) {
      return { key: platformKey, source: 'trial' };
    }
    throw new ProviderKeyRequiredError(
      provider,
      result.reason === 'trial_exhausted',
      result.reason,
    );
  }

  // No workspace context — require BYOK
  throw new ProviderKeyRequiredError(provider, false);
}

/** Fire-and-forget update of last_used_at for usage tracking. */
function touchLastUsed(supabase: ReturnType<typeof createServiceClient>, keyId: string): void {
  supabase
    .from('provider_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyId)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            module: 'resolve-provider-key',
            action: 'touchLastUsed',
            keyId,
            error: error.message,
            ts: new Date().toISOString(),
          }),
        );
      }
    });
}
