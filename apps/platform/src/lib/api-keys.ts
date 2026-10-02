import { randomBytes, createHash } from 'crypto';
import type { ApiKeyEnvironment } from '@repo/types';
import { hostConfig } from '@/lib/host-config';

const KEY_LENGTH = 32; // 32 bytes = 256 bits of entropy
/** Configurable key prefix, e.g. `celune`; keys look like `<prefix>_live_<random>`. */
export const API_KEY_PREFIX = hostConfig.apiKeyPrefix;
export const API_KEY_BEARER_PREFIX = `${API_KEY_PREFIX}_`;
/** Stored lookup prefix: `<prefix>_live_` plus two characters of the random part. */
export const PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

/**
 * Generate a new API key with format: {prefix}_{env}_{random}
 * Returns { key, hash, prefix } — key is shown once, hash is stored.
 */
export function generateApiKey(environment: ApiKeyEnvironment = 'live'): {
  key: string;
  hash: string;
  prefix: string;
} {
  const random = randomBytes(KEY_LENGTH).toString('base64url');
  const key = `${API_KEY_PREFIX}_${environment}_${random}`;
  const hash = hashApiKey(key);
  const prefix = key.slice(0, PREFIX_LENGTH);
  return { key, hash, prefix };
}

/**
 * Hash an API key using SHA-256 for storage.
 * Never store the plaintext key.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Extract the environment from a key prefix.
 */
export function parseKeyEnvironment(key: string): ApiKeyEnvironment | null {
  if (key.startsWith(`${API_KEY_PREFIX}_live_`)) return 'live';
  if (key.startsWith(`${API_KEY_PREFIX}_test_`)) return 'test';
  return null;
}
