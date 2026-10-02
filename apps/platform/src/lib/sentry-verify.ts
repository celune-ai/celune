/**
 * apps/platform/src/lib/sentry-verify.ts
 *
 * Shared Sentry webhook verification utilities. Uses HMAC-SHA256 signing
 * with the client secret configured in SENTRY_WEBHOOK_SECRET.
 */

import * as crypto from 'node:crypto';

const SENTRY_WEBHOOK_SECRET = process.env['SENTRY_WEBHOOK_SECRET'] ?? '';

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify a Sentry webhook request's HMAC-SHA256 signature.
 *
 * Sentry sends a `sentry-hook-signature` header containing the HMAC-SHA256
 * hex digest of the raw request body, signed with the client secret.
 */
/** Maximum age for a Sentry webhook request (5 minutes). */
const MAX_AGE_MS = 5 * 60 * 1000;

export function verifySentrySignature(
  signature: string | null,
  rawBody: string,
  timestamp?: string | null,
): VerificationResult {
  if (!SENTRY_WEBHOOK_SECRET) {
    return { valid: false, reason: 'SENTRY_WEBHOOK_SECRET not configured' };
  }
  if (!signature) {
    return { valid: false, reason: 'Missing sentry-hook-signature header' };
  }

  // Replay protection: reject requests older than 5 minutes
  if (timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      return { valid: false, reason: 'Invalid timestamp' };
    }
    const ageMs = Math.abs(Date.now() - ts * 1000);
    if (ageMs > MAX_AGE_MS) {
      return { valid: false, reason: 'Request too old (replay protection)' };
    }
  }

  const expected = crypto.createHmac('sha256', SENTRY_WEBHOOK_SECRET).update(rawBody).digest('hex');

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
