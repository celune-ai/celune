import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';

const SIGNING_SECRET = 'test-slack-signing-secret';

vi.stubEnv('SLACK_SIGNING_SECRET', SIGNING_SECRET);

// Import after env stub
const { verifySlackSignature } = await import('../slack-verify');

function makeSignature(body: string, timestamp: number, secret = SIGNING_SECRET) {
  const sigBasestring = `v0:${timestamp}:${body}`;
  return 'v0=' + crypto.createHmac('sha256', secret).update(sigBasestring).digest('hex');
}

describe('verifySlackSignature', () => {
  const now = Math.floor(Date.now() / 1000);

  it('accepts a valid signature', () => {
    const body = 'test=payload';
    const sig = makeSignature(body, now);
    const result = verifySlackSignature(sig, String(now), body);
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const body = 'test=payload';
    const sig = makeSignature(body, now, 'wrong-secret');
    const result = verifySlackSignature(sig, String(now), body);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid signature');
  });

  it('rejects expired timestamps', () => {
    const body = 'test=payload';
    const old = now - 600; // 10 minutes ago
    const sig = makeSignature(body, old);
    const result = verifySlackSignature(sig, String(old), body);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('replay');
  });

  it('rejects missing signature', () => {
    const result = verifySlackSignature(null, String(now), 'body');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing');
  });

  it('rejects missing timestamp', () => {
    const result = verifySlackSignature('v0=abc', null, 'body');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing');
  });
});
