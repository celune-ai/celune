import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createJobCrypto } from '../job-crypto.ts';

const MASTER = 'a'.repeat(64);
const JOB_KEY = 'b'.repeat(64);
const fields = {
  jobId: '550e8400-e29b-41d4-a716-446655440000',
  jobType: 'chat',
  model: 'm',
  nonce: 'n-1',
  workspaceId: 'ws-1',
};
const payload = `${fields.jobId}:${fields.jobType}:${fields.model}:${fields.nonce}:${fields.workspaceId}`;
const legacyKey = Buffer.from(
  hkdfSync('sha256', Buffer.from(MASTER, 'hex'), '', 'celune-job-hmac', 32),
);
const legacy = createHmac('sha256', legacyKey).update(payload).digest('hex');
const current = createHmac('sha256', Buffer.from(JOB_KEY, 'hex')).update(payload).digest('hex');

describe('createJobCrypto HMAC keys', () => {
  it('verifies HMACs from JOB_HMAC_KEY and from the legacy subkey', () => {
    const crypto = createJobCrypto(MASTER, JOB_KEY);
    expect(crypto.verifyHmac(fields, current)).toBe(true);
    expect(crypto.verifyHmac(fields, legacy)).toBe(true);
    expect(crypto.verifyHmac({ ...fields, workspaceId: 'ws-2' }, current)).toBe(false);
  });

  it('verifies only the legacy subkey without JOB_HMAC_KEY', () => {
    const crypto = createJobCrypto(MASTER);
    expect(crypto.verifyHmac(fields, legacy)).toBe(true);
    expect(crypto.verifyHmac(fields, current)).toBe(false);
  });

  it('refuses a malformed JOB_HMAC_KEY', () => {
    expect(() => createJobCrypto(MASTER, 'short')).toThrow(/JOB_HMAC_KEY/);
  });
});
