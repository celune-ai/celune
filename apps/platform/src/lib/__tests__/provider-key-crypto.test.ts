import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptProviderKey,
  decryptProviderKey,
  extractKeySuffix,
  validateMasterKey,
} from '../provider-key-crypto';

// Valid 32-byte key expressed as 64 hex characters
const TEST_KEY = 'a'.repeat(64);

describe('provider-key-crypto', () => {
  const originalEnv = process.env.PROVIDER_KEY_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.PROVIDER_KEY_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PROVIDER_KEY_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.PROVIDER_KEY_ENCRYPTION_KEY;
    }
  });

  describe('validateMasterKey', () => {
    it('returns true when key is valid', () => {
      expect(validateMasterKey()).toBe(true);
    });

    it('throws when env var is missing', () => {
      delete process.env.PROVIDER_KEY_ENCRYPTION_KEY;
      expect(() => validateMasterKey()).toThrow('PROVIDER_KEY_ENCRYPTION_KEY is not set');
    });

    it('throws when key is wrong length', () => {
      process.env.PROVIDER_KEY_ENCRYPTION_KEY = 'abcd1234';
      expect(() => validateMasterKey()).toThrow('must be exactly 64 hex characters');
    });

    it('throws when key contains non-hex characters', () => {
      process.env.PROVIDER_KEY_ENCRYPTION_KEY = 'g'.repeat(64);
      expect(() => validateMasterKey()).toThrow('must be exactly 64 hex characters');
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    it('round-trips a typical API key', () => {
      const plaintext = 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxx';
      const { encryptedKey, iv } = encryptProviderKey(plaintext);
      const decrypted = decryptProviderKey(encryptedKey, iv);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      const { encryptedKey, iv } = encryptProviderKey('');
      const decrypted = decryptProviderKey(encryptedKey, iv);
      expect(decrypted).toBe('');
    });

    it('round-trips unicode content', () => {
      const plaintext = 'key-with-émojis-🔑';
      const { encryptedKey, iv } = encryptProviderKey(plaintext);
      expect(decryptProviderKey(encryptedKey, iv)).toBe(plaintext);
    });

    it('produces different ciphertext for the same plaintext (unique IV)', () => {
      const plaintext = 'sk-test-key';
      const a = encryptProviderKey(plaintext);
      const b = encryptProviderKey(plaintext);
      expect(a.encryptedKey).not.toBe(b.encryptedKey);
      expect(a.iv).not.toBe(b.iv);
    });
  });

  describe('tamper detection', () => {
    it('throws when ciphertext is modified', () => {
      const { encryptedKey, iv } = encryptProviderKey('test-key');
      const buf = Buffer.from(encryptedKey, 'base64');
      buf[0] ^= 0xff; // flip a byte
      const tampered = buf.toString('base64');
      expect(() => decryptProviderKey(tampered, iv)).toThrow();
    });

    it('throws when IV is modified', () => {
      const { encryptedKey, iv } = encryptProviderKey('test-key');
      const buf = Buffer.from(iv, 'base64');
      buf[0] ^= 0xff;
      const tamperedIv = buf.toString('base64');
      expect(() => decryptProviderKey(encryptedKey, tamperedIv)).toThrow();
    });

    it('throws when encrypted data is too short', () => {
      expect(() => decryptProviderKey('c2hvcnQ=', 'AAAAAAAAAAAAAAAA')).toThrow(
        'Encrypted data is too short',
      );
    });
  });

  describe('extractKeySuffix', () => {
    it('returns last 4 characters', () => {
      expect(extractKeySuffix('sk-ant-api03-abcdefghijklmnop')).toBe('mnop');
    });

    it('returns full string if shorter than 4 chars', () => {
      expect(extractKeySuffix('abc')).toBe('abc');
    });

    it('handles empty string', () => {
      expect(extractKeySuffix('')).toBe('');
    });
  });
});
