import { describe, it, expect } from 'vitest';
import {
  createPasswordHash,
  verifyPasswordHash,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  KEY_BYTES,
} from '../password-hash';

describe('password-hash constants', () => {
  it('uses 100k iterations', () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
  });

  it('uses 16-byte salt', () => {
    expect(SALT_BYTES).toBe(16);
  });

  it('uses 32-byte key', () => {
    expect(KEY_BYTES).toBe(32);
  });
});

describe('createPasswordHash', () => {
  it('returns a string in "salt:hash" format', async () => {
    const result = await createPasswordHash('test-password');
    const parts = result.split(':');
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBe(SALT_BYTES * 2); // hex-encoded salt
    expect(parts[1].length).toBe(KEY_BYTES * 2); // hex-encoded hash
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const hash1 = await createPasswordHash('same-password');
    const hash2 = await createPasswordHash('same-password');
    expect(hash1).not.toBe(hash2);
  });
});

describe('verifyPasswordHash', () => {
  it('verifies a correct password', async () => {
    const stored = await createPasswordHash('my-secret');
    expect(await verifyPasswordHash('my-secret', stored)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const stored = await createPasswordHash('my-secret');
    expect(await verifyPasswordHash('wrong-password', stored)).toBe(false);
  });

  it('returns false for malformed stored hash (no colon)', async () => {
    expect(await verifyPasswordHash('test', 'nocolon')).toBe(false);
  });

  it('returns false for empty salt or hash parts', async () => {
    expect(await verifyPasswordHash('test', ':')).toBe(false);
  });
});
