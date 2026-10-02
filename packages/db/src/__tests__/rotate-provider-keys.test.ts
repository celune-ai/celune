import { describe, it, expect } from 'vitest';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Tests for the encryption/decryption logic used by rotate-provider-keys.mjs.
 *
 * Since the script is a standalone CLI tool with inline functions, we replicate
 * the same crypto logic here to verify correctness. These functions mirror
 * decryptWithKey() and encryptWithKey() in the rotation script exactly.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function decryptWithKey(keyHex: string, encryptedKey: string, iv: string): string {
  const keyBuf = Buffer.from(keyHex, 'hex');
  let rawBase64 = encryptedKey;
  if (rawBase64.startsWith('v1:')) rawBase64 = rawBase64.slice(3);
  if (rawBase64.startsWith('v2:')) rawBase64 = rawBase64.slice(3);

  const encBuf = Buffer.from(rawBase64, 'base64');
  const ivBuf = Buffer.from(iv, 'base64');
  const ciphertext = encBuf.subarray(0, encBuf.length - AUTH_TAG_BYTES);
  const authTag = encBuf.subarray(encBuf.length - AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, keyBuf, ivBuf);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function encryptWithKey(keyHex: string, plaintext: string): { encryptedKey: string; iv: string } {
  const keyBuf = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBuf, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encBuf = Buffer.concat([ciphertext, authTag]);
  return {
    encryptedKey: `v2:${encBuf.toString('base64')}`,
    iv: iv.toString('base64'),
  };
}

const TEST_KEY_V1 = 'a'.repeat(64);
const TEST_KEY_V2 = 'b'.repeat(64);

describe('rotate-provider-keys crypto', () => {
  describe('encryptWithKey', () => {
    it('produces v2-prefixed output', () => {
      const { encryptedKey } = encryptWithKey(TEST_KEY_V1, 'sk-test-1234');
      expect(encryptedKey.startsWith('v2:')).toBe(true);
    });

    it('produces base64 payload after prefix', () => {
      const { encryptedKey } = encryptWithKey(TEST_KEY_V1, 'sk-test-1234');
      const payload = encryptedKey.slice(3);
      expect(() => Buffer.from(payload, 'base64')).not.toThrow();
    });

    it('produces base64-encoded IV', () => {
      const { iv } = encryptWithKey(TEST_KEY_V1, 'sk-test-1234');
      const ivBuf = Buffer.from(iv, 'base64');
      expect(ivBuf.length).toBe(IV_BYTES);
    });

    it('produces different ciphertext each time (unique IV)', () => {
      const a = encryptWithKey(TEST_KEY_V1, 'same-plaintext');
      const b = encryptWithKey(TEST_KEY_V1, 'same-plaintext');
      expect(a.encryptedKey).not.toBe(b.encryptedKey);
      expect(a.iv).not.toBe(b.iv);
    });
  });

  describe('decryptWithKey', () => {
    it('round-trips plaintext through encrypt → decrypt', () => {
      const plaintext = 'sk-ant-api03-test-key-value';
      const { encryptedKey, iv } = encryptWithKey(TEST_KEY_V1, plaintext);
      const decrypted = decryptWithKey(TEST_KEY_V1, encryptedKey, iv);
      expect(decrypted).toBe(plaintext);
    });

    it('handles v1: prefix on encrypted data', () => {
      // Simulate a v1-encrypted key (no prefix, raw base64)
      const plaintext = 'sk-test-v1-key';
      const keyBuf = Buffer.from(TEST_KEY_V1, 'hex');
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, keyBuf, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const encBuf = Buffer.concat([ciphertext, authTag]);

      // With v1: prefix
      const encrypted = `v1:${encBuf.toString('base64')}`;
      const ivBase64 = iv.toString('base64');
      expect(decryptWithKey(TEST_KEY_V1, encrypted, ivBase64)).toBe(plaintext);
    });

    it('handles raw base64 without version prefix', () => {
      const plaintext = 'sk-test-no-prefix';
      const keyBuf = Buffer.from(TEST_KEY_V1, 'hex');
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, keyBuf, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const encBuf = Buffer.concat([ciphertext, authTag]);

      const encrypted = encBuf.toString('base64'); // no prefix
      const ivBase64 = iv.toString('base64');
      expect(decryptWithKey(TEST_KEY_V1, encrypted, ivBase64)).toBe(plaintext);
    });

    it('throws on wrong key', () => {
      const { encryptedKey, iv } = encryptWithKey(TEST_KEY_V1, 'secret');
      expect(() => decryptWithKey(TEST_KEY_V2, encryptedKey, iv)).toThrow();
    });

    it('throws on tampered ciphertext', () => {
      const { encryptedKey, iv } = encryptWithKey(TEST_KEY_V1, 'secret');
      // Flip a byte in the base64 payload
      const payload = Buffer.from(encryptedKey.slice(3), 'base64');
      payload[0] ^= 0xff;
      const tampered = `v2:${payload.toString('base64')}`;
      expect(() => decryptWithKey(TEST_KEY_V1, tampered, iv)).toThrow();
    });
  });

  describe('key rotation flow', () => {
    it('decrypts v1-encrypted key with v1 key, re-encrypts with v2, decrypts with v2', () => {
      const plaintext = 'sk-ant-api03-real-key-value-1234';

      // Step 1: Encrypt with v1 (simulating original key storage)
      const keyBuf = Buffer.from(TEST_KEY_V1, 'hex');
      const iv1 = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, keyBuf, iv1);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const v1Encrypted = Buffer.concat([ciphertext, authTag]).toString('base64');
      const iv1Base64 = iv1.toString('base64');

      // Step 2: Decrypt with v1
      const decrypted = decryptWithKey(TEST_KEY_V1, v1Encrypted, iv1Base64);
      expect(decrypted).toBe(plaintext);

      // Step 3: Re-encrypt with v2
      const { encryptedKey: v2Encrypted, iv: iv2Base64 } = encryptWithKey(TEST_KEY_V2, decrypted);

      // Step 4: Verify round-trip with v2
      const verified = decryptWithKey(TEST_KEY_V2, v2Encrypted, iv2Base64);
      expect(verified).toBe(plaintext);

      // Step 5: Verify v1 can no longer decrypt v2 data
      expect(() => decryptWithKey(TEST_KEY_V1, v2Encrypted, iv2Base64)).toThrow();
    });

    it('validates suffix matching', () => {
      const plaintext = 'sk-ant-api03-abcd';
      const expectedSuffix = plaintext.slice(-4); // 'abcd'
      expect(expectedSuffix).toBe('abcd');

      const { encryptedKey, iv } = encryptWithKey(TEST_KEY_V1, plaintext);
      const decrypted = decryptWithKey(TEST_KEY_V1, encryptedKey, iv);
      expect(decrypted.slice(-4)).toBe(expectedSuffix);
    });
  });
});
