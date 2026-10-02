/**
 * packages/notifications/src/decrypt-webhook.ts
 *
 * Decrypts Slack webhook URLs that were encrypted with AES-256-GCM
 * using the same PROVIDER_KEY_ENCRYPTION_KEY used by provider-key-crypto.ts.
 *
 * Falls back to plaintext incoming_webhook_url for pre-migration rows
 * that haven't been backfilled yet.
 */

import { createDecipheriv } from 'crypto';
import type { SlackConnection } from './types';

const AUTH_TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';

function getMasterKey(): Buffer {
  const raw = process.env.PROVIDER_KEY_ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error('PROVIDER_KEY_ENCRYPTION_KEY is not set or invalid');
  }
  return Buffer.from(raw, 'hex');
}

function decrypt(encryptedKey: string, iv: string): string {
  const masterKey = getMasterKey();

  let rawBase64 = encryptedKey;
  if (encryptedKey.startsWith('v1:')) {
    rawBase64 = encryptedKey.slice(3);
  }

  const encryptedBuffer = Buffer.from(rawBase64, 'base64');
  const ivBuffer = Buffer.from(iv, 'base64');

  if (encryptedBuffer.length < AUTH_TAG_BYTES) {
    throw new Error('Encrypted data is too short — missing auth tag.');
  }

  const ciphertext = encryptedBuffer.subarray(0, encryptedBuffer.length - AUTH_TAG_BYTES);
  const authTag = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, masterKey, ivBuffer);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Resolve the webhook URL from a SlackConnection row.
 * Prefers encrypted columns; falls back to plaintext for un-migrated rows.
 */
export function decryptWebhookUrl(conn: SlackConnection): string | null {
  // If encrypted columns are populated, decrypt
  if (conn.encrypted_webhook_url && conn.webhook_iv) {
    return decrypt(conn.encrypted_webhook_url, conn.webhook_iv);
  }

  // Fallback: plaintext (pre-migration rows). NULL for bot-token installs.
  return conn.incoming_webhook_url;
}

/** Minimal fields required by decryptBotToken — avoids forcing a full SlackConnection select. */
export type BotTokenFields = Pick<SlackConnection, 'bot_token_encrypted' | 'bot_token_iv'>;

/**
 * Resolve the bot token from a SlackConnection row (or partial row with token fields).
 * Returns null if no bot token is stored (webhook-only installation).
 */
export function decryptBotToken(conn: BotTokenFields): string | null {
  if (conn.bot_token_encrypted && conn.bot_token_iv) {
    return decrypt(conn.bot_token_encrypted, conn.bot_token_iv);
  }
  return null;
}
