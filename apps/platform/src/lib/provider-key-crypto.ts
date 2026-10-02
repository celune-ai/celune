/**
 * AES-256-GCM encryption utilities for provider API keys.
 *
 * Server-side only — never import this in client components.
 * Master key is read from PROVIDER_KEY_ENCRYPTION_KEY (64 hex chars = 32 bytes).
 *
 * Encryption scheme:
 *   - Algorithm: AES-256-GCM
 *   - IV: 12 random bytes per encryption (never reused)
 *   - Auth tag: 16 bytes, appended to ciphertext
 *   - Storage: encryptedKey = base64(ciphertext + authTag), iv = base64(iv)
 *
 * Key rotation procedure:
 *   1. Set PROVIDER_KEY_ENCRYPTION_KEY_V2 to the new key (openssl rand -hex 32)
 *   2. Run: node packages/db/scripts/rotate-provider-keys.mjs
 *      This decrypts all keys with v1, re-encrypts with v2, updates the DB.
 *   3. Swap env vars: rename _V2 to PROVIDER_KEY_ENCRYPTION_KEY, remove the old one.
 *   4. Deploy. decryptProviderKey() auto-detects the version prefix.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';
const HEX_KEY_LENGTH = 64; // 32 bytes expressed as hex

/*
 * Key version prefix format: "v<N>:" prepended to the base64-encoded ciphertext.
 *   - v1: encrypted with PROVIDER_KEY_ENCRYPTION_KEY
 *   - v2: encrypted with PROVIDER_KEY_ENCRYPTION_KEY_V2 (during rotation)
 *
 * After rotation completes (v2 key renamed to PROVIDER_KEY_ENCRYPTION_KEY,
 * _V2 removed), new encryptions are tagged v1 again. The rotation script
 * re-encrypts ALL existing rows, so no old-key v1 data should remain.
 *
 * IMPORTANT: Do not insert new keys between running the rotation script and
 * swapping env vars. Keys inserted in that window would use the old key with
 * a v1 prefix and become undecryptable after the swap.
 */

/**
 * Validate that the master key env var exists and is the correct format.
 * Returns true if valid, throws with a descriptive message if not.
 */
export function validateMasterKey(): true {
  const raw = process.env.PROVIDER_KEY_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'PROVIDER_KEY_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32',
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error(
      `PROVIDER_KEY_ENCRYPTION_KEY must be exactly ${HEX_KEY_LENGTH} hex characters (32 bytes). ` +
        `Got ${raw.length} characters.`,
    );
  }
  return true;
}

function validateHexKey(key: string, label: string): void {
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error(
      `${label} must be exactly ${HEX_KEY_LENGTH} hex characters (32 bytes). Got ${key.length} characters.`,
    );
  }
}

/**
 * Derive the current master key buffer from the environment variable.
 * During rotation, PROVIDER_KEY_ENCRYPTION_KEY_V2 is the new key;
 * PROVIDER_KEY_ENCRYPTION_KEY is the old key (v1).
 */
function getMasterKey(): Buffer {
  // Prefer v2 key if set (during/after rotation)
  const v2 = process.env.PROVIDER_KEY_ENCRYPTION_KEY_V2;
  if (v2) {
    validateHexKey(v2, 'PROVIDER_KEY_ENCRYPTION_KEY_V2');
    return Buffer.from(v2, 'hex');
  }
  // Fall back to v1 key
  validateMasterKey();
  return Buffer.from(process.env.PROVIDER_KEY_ENCRYPTION_KEY!, 'hex');
}

/**
 * Get the v1 master key (original). Used during decryption of v1-encrypted data.
 */
function getV1MasterKey(): Buffer {
  validateMasterKey();
  return Buffer.from(process.env.PROVIDER_KEY_ENCRYPTION_KEY!, 'hex');
}

/**
 * Encrypt a provider API key using AES-256-GCM.
 *
 * @param plaintext - The raw API key string to encrypt
 * @returns An object with:
 *   - encryptedKey: versioned base64-encoded ciphertext with auth tag appended
 *   - iv: base64-encoded 12-byte initialization vector
 */
export function encryptProviderKey(plaintext: string): { encryptedKey: string; iv: string } {
  const masterKey = getMasterKey();
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Append auth tag to ciphertext so decryption can verify integrity
  const encryptedBuffer = Buffer.concat([ciphertext, authTag]);

  // Determine version prefix based on which key was used
  const version = process.env.PROVIDER_KEY_ENCRYPTION_KEY_V2 ? 'v2' : 'v1';

  return {
    encryptedKey: `${version}:${encryptedBuffer.toString('base64')}`,
    iv: iv.toString('base64'),
  };
}

/**
 * Core decryption using a specific key buffer.
 */
function decryptWithKey(keyBuf: Buffer, rawBase64: string, iv: string): string {
  const encryptedBuffer = Buffer.from(rawBase64, 'base64');
  const ivBuffer = Buffer.from(iv, 'base64');

  if (encryptedBuffer.length < AUTH_TAG_BYTES) {
    throw new Error('Encrypted data is too short — missing auth tag.');
  }

  const ciphertext = encryptedBuffer.subarray(0, encryptedBuffer.length - AUTH_TAG_BYTES);
  const authTag = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, keyBuf, ivBuffer);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Decrypt a provider API key using AES-256-GCM.
 * Verifies the auth tag — throws if the data has been tampered with.
 *
 * Auto-detects key version from the prefix:
 *   - "v2:" → decrypt with PROVIDER_KEY_ENCRYPTION_KEY_V2 (or PROVIDER_KEY_ENCRYPTION_KEY if v2 is now primary)
 *   - "v1:" or no prefix → decrypt with PROVIDER_KEY_ENCRYPTION_KEY
 *
 * @param encryptedKey - versioned base64-encoded ciphertext with auth tag appended
 * @param iv - base64-encoded 12-byte initialization vector
 * @returns The decrypted plaintext API key
 */
export function decryptProviderKey(encryptedKey: string, iv: string): string {
  if (encryptedKey.startsWith('v2:')) {
    const rawBase64 = encryptedKey.slice(3);
    // v2 data: try the v2 key first, fall back to current primary
    const v2Key = process.env.PROVIDER_KEY_ENCRYPTION_KEY_V2;
    if (v2Key) {
      validateHexKey(v2Key, 'PROVIDER_KEY_ENCRYPTION_KEY_V2');
      return decryptWithKey(Buffer.from(v2Key, 'hex'), rawBase64, iv);
    }
    // After rotation is complete, PROVIDER_KEY_ENCRYPTION_KEY IS the v2 key
    return decryptWithKey(getV1MasterKey(), rawBase64, iv);
  }

  // v1 or unversioned — use v1 key
  const rawBase64 = encryptedKey.startsWith('v1:') ? encryptedKey.slice(3) : encryptedKey;
  return decryptWithKey(getV1MasterKey(), rawBase64, iv);
}

/**
 * Extract the last 4 characters of an API key for display purposes.
 * Safe to store unencrypted alongside the encrypted key.
 *
 * @param key - The plaintext API key
 * @returns Last 4 characters, or the full string if shorter than 4 chars
 */
export function extractKeySuffix(key: string): string {
  return key.slice(-4);
}
