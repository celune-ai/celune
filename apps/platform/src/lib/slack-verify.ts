/**
 * apps/platform/src/lib/slack-verify.ts
 *
 * Shared Slack request verification utilities for Events API, slash commands,
 * and interactive components. Uses HMAC-SHA256 signing with replay protection.
 */

import * as crypto from 'node:crypto';

const SLACK_SIGNING_SECRET = process.env['SLACK_SIGNING_SECRET'] ?? '';

/** Max age of a Slack request before we reject it (replay protection). */
const MAX_REQUEST_AGE_S = 300; // 5 minutes

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify a Slack request's HMAC-SHA256 signature.
 * Used by Events API, slash commands, and interactive components.
 */
export function verifySlackSignature(
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
): VerificationResult {
  if (!SLACK_SIGNING_SECRET) {
    return { valid: false, reason: 'SLACK_SIGNING_SECRET not configured' };
  }
  if (!signature || !timestamp) {
    return { valid: false, reason: 'Missing signature or timestamp header' };
  }

  // Replay protection
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_REQUEST_AGE_S) {
    return { valid: false, reason: 'Request too old (replay protection)' };
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const expected =
    'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(sigBasestring).digest('hex');

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);

  if (expectedBuf.length !== signatureBuf.length) {
    return { valid: false, reason: 'Invalid signature' };
  }

  if (!crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}
