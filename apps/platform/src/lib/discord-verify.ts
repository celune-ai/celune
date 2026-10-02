/**
 * Discord Ed25519 signature verification using Node.js crypto.
 *
 * Discord sends two headers with each interaction request:
 *   - X-Signature-Ed25519: hex-encoded Ed25519 signature
 *   - X-Signature-Timestamp: timestamp string
 *
 * The signed message is: timestamp + body (both as UTF-8).
 * The public key is hex-encoded, obtained from the Discord app dashboard.
 */

import crypto from 'crypto';

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

/**
 * Verify a Discord interaction request signature.
 * Returns true if the signature is valid.
 */
export function verifyDiscordSignature(
  signature: string | null,
  timestamp: string | null,
  body: string,
): boolean {
  if (!signature || !timestamp || !DISCORD_PUBLIC_KEY) return false;

  try {
    const message = Buffer.from(timestamp + body);
    const sig = Buffer.from(signature, 'hex');
    const key = crypto.createPublicKey({
      key: Buffer.concat([
        // Ed25519 public key DER prefix
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(DISCORD_PUBLIC_KEY, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });

    return crypto.verify(null, message, key, sig);
  } catch (err) {
    console.error('[discord-verify] Signature verification error:', err);
    return false;
  }
}
