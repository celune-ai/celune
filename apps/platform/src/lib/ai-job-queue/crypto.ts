/**
 * AES-256-GCM encryption + HMAC signing for AI job queue payloads.
 *
 * Payload encryption reuses the provider-key master key (PROVIDER_KEY_ENCRYPTION_KEY).
 * Each field gets its own random IV — never reused.
 *
 * HMAC: SHA-256 keyed hash of the job payload so the IDE can prove
 * it received the original job when submitting results. Signed with JOB_HMAC_KEY.
 * Until JOB_HMAC_KEY is set, and for jobs signed before it was, the HMAC key is the
 * legacy HKDF subkey of PROVIDER_KEY_ENCRYPTION_KEY. The fallback is removed in the release after this one.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';

function getMasterKeyBuffer(): Buffer {
  const key = process.env.PROVIDER_KEY_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error('PROVIDER_KEY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

/** Derive a purpose-specific subkey from the master key using HKDF. */
function deriveEncryptKey(): Buffer {
  const master = getMasterKeyBuffer();
  return Buffer.from(hkdfSync('sha256', master, '', 'celune-job-encrypt', 32));
}

/** The legacy HMAC key: an HKDF subkey of the provider-key master key. */
function deriveLegacyHmacKey(): Buffer | null {
  const key = process.env.PROVIDER_KEY_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) return null;
  return Buffer.from(hkdfSync('sha256', Buffer.from(key, 'hex'), '', 'celune-job-hmac', 32));
}

function jobHmacKey(): Buffer | null {
  const key = process.env.JOB_HMAC_KEY?.trim();
  if (!key) return null;
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('JOB_HMAC_KEY must be 64 hex chars (32 bytes)');
  return Buffer.from(key, 'hex');
}

/** Signing key first, then the legacy key that still verifies older jobs. */
function hmacKeys(): Buffer[] {
  const keys = [jobHmacKey(), deriveLegacyHmacKey()].filter((k): k is Buffer => k !== null);
  if (keys.length === 0) {
    throw new Error('JOB_HMAC_KEY or PROVIDER_KEY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }
  return keys;
}

type JobHmacFields = {
  jobId: string;
  jobType: string;
  model: string;
  nonce: string;
  workspaceId: string;
};

function hmacWith(key: Buffer, fields: JobHmacFields): string {
  const payload = `${fields.jobId}:${fields.jobType}:${fields.model}:${fields.nonce}:${fields.workspaceId}`;
  return createHmac('sha256', key).update(payload).digest('hex');
}

/**
 * Encrypt a string payload to BYTEA-compatible Buffer + IV.
 */
export function encryptPayload(plaintext: string): { encrypted: Buffer; iv: Buffer } {
  const encKey = deriveEncryptKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([ciphertext, authTag]),
    iv,
  };
}

/**
 * Decrypt a BYTEA payload back to string.
 */
export function decryptPayload(encrypted: Buffer, iv: Buffer): string {
  const encKey = deriveEncryptKey();
  if (encrypted.length < AUTH_TAG_BYTES) {
    throw new Error('Encrypted data too short — missing auth tag');
  }
  const ciphertext = encrypted.subarray(0, encrypted.length - AUTH_TAG_BYTES);
  const authTag = encrypted.subarray(encrypted.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, encKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Compute HMAC-SHA256 of a job's key fields.
 * The IDE must echo this back when submitting results.
 */
export function signJobHmac(fields: JobHmacFields): string {
  return hmacWith(hmacKeys()[0], fields);
}

/**
 * Verify an HMAC matches expected value.
 */
export function verifyJobHmac(fields: JobHmacFields, hmac: string): boolean {
  return hmacKeys().some((key) => {
    const expected = hmacWith(key, fields);
    if (expected.length !== hmac.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(hmac));
  });
}
