/**
 * Self-host copy of the platform's job payload crypto: AES-256-GCM with a key
 * derived from PROVIDER_KEY_ENCRYPTION_KEY, and an HMAC over the job identity
 * keyed by JOB_HMAC_KEY. Both hosts must use the same keys or an IDE cannot
 * decrypt what the other wrote. Verification also accepts the legacy HMAC key
 * (an HKDF subkey of the master key) so jobs signed before the split still verify;
 * that fallback is removed in the release after this one.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { JobCrypto } from '@celuneai/api';

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.startsWith('\\x') ? hex.slice(2) : hex, 'hex');
}

const HEX_KEY = /^[0-9a-f]{64}$/i;

export function createJobCrypto(masterKeyHex: string, jobHmacKeyHex?: string): JobCrypto {
  if (!HEX_KEY.test(masterKeyHex)) {
    throw new Error('PROVIDER_KEY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }
  if (jobHmacKeyHex && !HEX_KEY.test(jobHmacKeyHex)) {
    throw new Error('JOB_HMAC_KEY must be 64 hex chars (32 bytes)');
  }
  const master = Buffer.from(masterKeyHex, 'hex');
  const encKey = Buffer.from(hkdfSync('sha256', master, '', 'celune-job-encrypt', 32));
  const legacyHmacKey = Buffer.from(hkdfSync('sha256', master, '', 'celune-job-hmac', 32));
  const hmacKeys = jobHmacKeyHex
    ? [Buffer.from(jobHmacKeyHex, 'hex'), legacyHmacKey]
    : [legacyHmacKey];

  return {
    decrypt(encryptedHex, ivHex) {
      const encrypted = hexToBuffer(encryptedHex);
      if (encrypted.length < AUTH_TAG_BYTES) throw new Error('Encrypted data too short');
      const ciphertext = encrypted.subarray(0, encrypted.length - AUTH_TAG_BYTES);
      const authTag = encrypted.subarray(encrypted.length - AUTH_TAG_BYTES);
      const decipher = createDecipheriv(ALGORITHM, encKey, hexToBuffer(ivHex));
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
    encrypt(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, encKey, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const encrypted = Buffer.concat([ciphertext, cipher.getAuthTag()]);
      return {
        result_encrypted: '\\x' + encrypted.toString('hex'),
        result_iv: '\\x' + iv.toString('hex'),
      };
    },
    verifyHmac(fields, hmac) {
      const payload = `${fields.jobId}:${fields.jobType}:${fields.model}:${fields.nonce}:${fields.workspaceId}`;
      return hmacKeys.some((key) => {
        const expected = createHmac('sha256', key).update(payload).digest('hex');
        if (expected.length !== hmac.length) return false;
        return timingSafeEqual(Buffer.from(expected), Buffer.from(hmac));
      });
    },
  };
}
