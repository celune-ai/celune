/**
 * Runtime Credential Resolver
 *
 * Resolves platform credentials from the vault (platform_credentials table),
 * falling back to environment variables when no vault entry exists.
 *
 * Includes an in-memory cache with a 5-minute TTL to avoid repeated DB lookups.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv } from 'crypto';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const AUTH_TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createSupabaseClient(url, key);
}

function decryptValue(encryptedBase64: string, ivBase64: string): string {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is not set or invalid');
  }

  const masterKey = Buffer.from(raw, 'hex');
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const iv = Buffer.from(ivBase64, 'base64');

  if (encrypted.length < AUTH_TAG_BYTES) {
    throw new Error('Encrypted data too short');
  }

  const ciphertext = encrypted.subarray(0, encrypted.length - AUTH_TAG_BYTES);
  const authTag = encrypted.subarray(encrypted.length - AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Convert category + key_name to an env var name.
 * e.g. ("discord", "BOT_TOKEN") → "DISCORD_BOT_TOKEN"
 */
function toEnvVarName(category: string, keyName: string): string {
  return `${category.toUpperCase()}_${keyName.toUpperCase()}`.replace(/[^A-Z0-9_]/g, '_');
}

/**
 * Resolve a credential value.
 *
 * Lookup order:
 *   1. In-memory cache (5-minute TTL)
 *   2. platform_credentials table (vault)
 *   3. Environment variable fallback
 *
 * @param category - Credential category (e.g. 'discord', 'stripe')
 * @param keyName - Key name within category (e.g. 'BOT_TOKEN', 'SECRET_KEY')
 * @returns The resolved plaintext value, or null if not found anywhere
 */
export async function resolveCredential(category: string, keyName: string): Promise<string | null> {
  const cacheKey = `${category}:${keyName}`;
  const now = Date.now();

  // 1. Check cache
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  // 2. Check vault
  try {
    const supabase = getServiceClient();
    const { data } = await supabase
      .from('platform_credentials')
      .select('encrypted_value, value_iv')
      .eq('category', category)
      .eq('key_name', keyName)
      .eq('is_active', true)
      .maybeSingle();

    if (data?.encrypted_value && data?.value_iv) {
      const value = decryptValue(data.encrypted_value, data.value_iv);
      cache.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
      return value;
    }
  } catch (e) {
    console.error(`[credential-resolver] Failed to resolve ${category}/${keyName} from vault:`, e);
    // Fall through to env var
  }

  // 3. Fallback to env var
  const envName = toEnvVarName(category, keyName);
  const envValue = process.env[envName] ?? null;
  cache.set(cacheKey, { value: envValue, expiresAt: now + CACHE_TTL_MS });
  return envValue;
}

/**
 * Invalidate the cache for a specific credential (call after update/delete).
 */
export function invalidateCredentialCache(category: string, keyName: string): void {
  cache.delete(`${category}:${keyName}`);
}

/**
 * Clear the entire credential cache.
 */
export function clearCredentialCache(): void {
  cache.clear();
}
