import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createHmac, hkdfSync } from 'crypto';
import { encryptPayload, decryptPayload, signJobHmac, verifyJobHmac } from '../crypto';

// Set a test encryption key (32 bytes = 64 hex chars)
beforeAll(() => {
  process.env.PROVIDER_KEY_ENCRYPTION_KEY =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
});

describe('encryptPayload / decryptPayload', () => {
  it('round-trips a string through encrypt and decrypt', () => {
    const original = 'Hello, IDE-first execution!';
    const { encrypted, iv } = encryptPayload(original);
    const decrypted = decryptPayload(encrypted, iv);
    expect(decrypted).toBe(original);
  });

  it('round-trips JSON payloads', () => {
    const payload = JSON.stringify({ messages: [{ role: 'user', content: 'test' }] });
    const { encrypted, iv } = encryptPayload(payload);
    const decrypted = decryptPayload(encrypted, iv);
    expect(JSON.parse(decrypted)).toEqual(JSON.parse(payload));
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const text = 'same input';
    const a = encryptPayload(text);
    const b = encryptPayload(text);
    expect(a.encrypted.equals(b.encrypted)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
  });

  it('throws on truncated ciphertext (missing auth tag)', () => {
    const { iv } = encryptPayload('test');
    const tooShort = Buffer.alloc(4);
    expect(() => decryptPayload(tooShort, iv)).toThrow('Encrypted data too short');
  });
});

describe('signJobHmac / verifyJobHmac', () => {
  const fields = {
    jobId: '550e8400-e29b-41d4-a716-446655440000',
    jobType: 'chat' as const,
    model: 'claude-sonnet-4-20250514',
    nonce: 'test-nonce-123',
    workspaceId: 'ws-001',
  };

  it('produces consistent output for the same input', () => {
    const hmac1 = signJobHmac(fields);
    const hmac2 = signJobHmac(fields);
    expect(hmac1).toBe(hmac2);
  });

  it('verifyJobHmac accepts a valid HMAC', () => {
    const hmac = signJobHmac(fields);
    expect(verifyJobHmac(fields, hmac)).toBe(true);
  });

  it('verifyJobHmac rejects an invalid HMAC', () => {
    expect(verifyJobHmac(fields, 'definitely-not-a-valid-hmac')).toBe(false);
  });

  it('verifyJobHmac rejects tampered fields', () => {
    const hmac = signJobHmac(fields);
    const tampered = { ...fields, jobId: 'tampered-id' };
    expect(verifyJobHmac(tampered, hmac)).toBe(false);
  });

  it('verifyJobHmac rejects tampered nonce', () => {
    const hmac = signJobHmac(fields);
    const tampered = { ...fields, nonce: 'different-nonce' };
    expect(verifyJobHmac(tampered, hmac)).toBe(false);
  });

  it('verifyJobHmac rejects tampered workspaceId', () => {
    const hmac = signJobHmac(fields);
    const tampered = { ...fields, workspaceId: 'ws-evil' };
    expect(verifyJobHmac(tampered, hmac)).toBe(false);
  });
});

describe('JOB_HMAC_KEY split', () => {
  const fields = {
    jobId: '550e8400-e29b-41d4-a716-446655440000',
    jobType: 'chat',
    model: 'claude-sonnet-4-20250514',
    nonce: 'n-1',
    workspaceId: 'ws-001',
  };
  const payload = `${fields.jobId}:${fields.jobType}:${fields.model}:${fields.nonce}:${fields.workspaceId}`;
  const jobKey = 'b'.repeat(64);
  const legacyKey = Buffer.from(
    hkdfSync('sha256', Buffer.from('a'.repeat(64), 'hex'), '', 'celune-job-hmac', 32),
  );

  afterEach(() => {
    delete process.env.JOB_HMAC_KEY;
  });

  it('signs with JOB_HMAC_KEY when it is set', () => {
    process.env.JOB_HMAC_KEY = jobKey;
    const expected = createHmac('sha256', Buffer.from(jobKey, 'hex')).update(payload).digest('hex');
    expect(signJobHmac(fields)).toBe(expected);
  });

  it('still verifies a job signed with the legacy derived key', () => {
    const legacy = createHmac('sha256', legacyKey).update(payload).digest('hex');
    process.env.JOB_HMAC_KEY = jobKey;
    expect(verifyJobHmac(fields, legacy)).toBe(true);
  });

  it('signs with the legacy derived key until JOB_HMAC_KEY is set', () => {
    const legacy = createHmac('sha256', legacyKey).update(payload).digest('hex');
    expect(signJobHmac(fields)).toBe(legacy);
  });

  it('refuses a malformed JOB_HMAC_KEY', () => {
    process.env.JOB_HMAC_KEY = 'short';
    expect(() => signJobHmac(fields)).toThrow(/JOB_HMAC_KEY/);
  });
});
