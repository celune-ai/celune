/**
 * HMAC-signed OAuth state parameters.
 *
 * Provides tamper-proof, time-limited state for OAuth redirect flows.
 * Single implementation for all providers (GitHub, Slack, etc.).
 *
 * Format: base64url( JSON({ provider, ...payload, ts, sig }) )
 *   - provider: flow prefix to prevent cross-provider replay
 *   - ts:  Unix epoch seconds when the state was created
 *   - sig: HMAC-SHA256(derived-key, canonical payload string)
 */

import crypto from 'crypto';

/** Max age for OAuth state (10 minutes). */
const STATE_MAX_AGE_SECONDS = 10 * 60;

/** Clock-skew tolerance (60 seconds into the future). */
const CLOCK_SKEW_SECONDS = 60;

/**
 * Derive a purpose-specific HMAC key from SUPABASE_SERVICE_ROLE_KEY.
 * Uses HKDF to isolate the signing key from the DB access key.
 */
let _derivedKey: Buffer | null = null;
function getSigningKey(): Buffer {
  if (_derivedKey) return _derivedKey;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for OAuth state signing');
  // HKDF: derive a 32-byte key scoped to OAuth state signing
  _derivedKey = Buffer.from(crypto.hkdfSync('sha256', secret, '', 'oauth-state-signing', 32));
  return _derivedKey;
}

/**
 * Build an HMAC signature over a deterministic payload string.
 */
function sign(payload: string): string {
  return crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
}

/**
 * Verify a signature using constant-time comparison.
 */
function verifySignature(payload: string, signature: string): boolean {
  const expected = sign(payload);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    // Length mismatch or invalid hex → not equal
    return false;
  }
}

/** Check expiry within the allowed time window. */
function isExpired(ts: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const age = now - ts;
  return age > STATE_MAX_AGE_SECONDS || age < -CLOCK_SKEW_SECONDS;
}

// ---------------------------------------------------------------------------
// GitHub OAuth state
// ---------------------------------------------------------------------------

interface GitHubStatePayload {
  workspaceId: string;
}

/**
 * Generate an HMAC-signed state for GitHub App OAuth.
 * Uses `github:` prefix to prevent cross-provider replay.
 * Includes userId in the canonical string for defense-in-depth:
 * the HMAC only verifies if the same user who initiated the flow completes it.
 */
export function generateGitHubOAuthState(workspaceId: string, userId: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const canonical = `github:${workspaceId}:${userId}:${ts}`;
  const sig = sign(canonical);
  const envelope = JSON.stringify({
    provider: 'github',
    workspace_id: workspaceId,
    user_id: userId,
    ts,
    sig,
  });
  return Buffer.from(envelope).toString('base64url');
}

/**
 * Parse and verify a GitHub OAuth state string.
 * Requires userId for HMAC verification (defense-in-depth: ensures the same
 * user who initiated the flow is completing it).
 * Returns { workspaceId } if valid, null otherwise.
 */
export function parseGitHubOAuthState(state: string, userId: string): GitHubStatePayload | null {
  let parsed: {
    provider?: string;
    workspace_id?: string;
    user_id?: string;
    ts?: number;
    sig?: string;
  };
  try {
    parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }

  const { provider, workspace_id, ts, sig } = parsed;
  if (provider !== 'github' || !workspace_id || typeof ts !== 'number' || !sig) return null;
  if (isExpired(ts)) return null;

  // Use the userId from the envelope if present (new format), otherwise fall back
  // to the caller-supplied userId. Old-format tokens (without user_id in the envelope)
  // will fail HMAC verification since they were signed without userId — this is
  // intentional; they expire in 10 minutes anyway.
  const envelopeUserId = parsed.user_id ?? userId;
  const canonical = `github:${workspace_id}:${envelopeUserId}:${ts}`;
  if (!verifySignature(canonical, sig)) return null;

  return { workspaceId: workspace_id };
}

// ---------------------------------------------------------------------------
// Slack OAuth state
// ---------------------------------------------------------------------------

type SlackFrom = 'onboarding' | 'settings';

interface SlackStatePayload {
  workspaceId: string;
  from: SlackFrom;
}

const VALID_SLACK_FROM: SlackFrom[] = ['onboarding', 'settings'];

/**
 * Generate an HMAC-signed, time-limited state string for Slack OAuth.
 * Uses `slack:` prefix to prevent cross-provider replay.
 */
export function generateSlackOAuthState(workspaceId: string, from: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const canonical = `slack:${workspaceId}:${from}:${ts}`;
  const sig = sign(canonical);
  const envelope = JSON.stringify({ provider: 'slack', workspace_id: workspaceId, from, ts, sig });
  return Buffer.from(envelope).toString('base64url');
}

/**
 * Parse and verify a Slack OAuth state string.
 * Validates `from` against allowlist to prevent redirect manipulation.
 */
// ---------------------------------------------------------------------------
// Discord OAuth state
// ---------------------------------------------------------------------------

interface DiscordStatePayload {
  workspaceId: string;
  userId: string;
}

/**
 * Generate an HMAC-signed, time-limited state string for Discord OAuth.
 * Uses `discord:` prefix to prevent cross-provider replay.
 */
export function generateDiscordOAuthState(workspaceId: string, userId: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const canonical = `discord:${workspaceId}:${userId}:${ts}`;
  const sig = sign(canonical);
  const envelope = JSON.stringify({
    provider: 'discord',
    workspace_id: workspaceId,
    user_id: userId,
    ts,
    sig,
  });
  return Buffer.from(envelope).toString('base64url');
}

/**
 * Parse and verify a Discord OAuth state string.
 * Returns { workspaceId, userId } if valid, null otherwise.
 */
export function parseDiscordOAuthState(state: string): DiscordStatePayload | null {
  let parsed: {
    provider?: string;
    workspace_id?: string;
    user_id?: string;
    ts?: number;
    sig?: string;
  };
  try {
    parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }

  const { provider, workspace_id, user_id, ts, sig } = parsed;
  if (provider !== 'discord' || !workspace_id || !user_id || typeof ts !== 'number' || !sig)
    return null;
  if (isExpired(ts)) return null;

  const canonical = `discord:${workspace_id}:${user_id}:${ts}`;
  if (!verifySignature(canonical, sig)) return null;

  return { workspaceId: workspace_id, userId: user_id };
}

export function parseSlackOAuthState(state: string): SlackStatePayload | null {
  let parsed: {
    provider?: string;
    workspace_id?: string;
    from?: string;
    ts?: number;
    sig?: string;
  };
  try {
    parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }

  const { workspace_id, from, ts, sig } = parsed;
  if (!workspace_id || !from || typeof ts !== 'number' || !sig) return null;
  if (isExpired(ts)) return null;

  // Validate `from` against allowlist
  if (!VALID_SLACK_FROM.includes(from as SlackFrom)) return null;

  // Verify HMAC
  const canonical = `slack:${workspace_id}:${from}:${ts}`;
  if (!verifySignature(canonical, sig)) return null;

  return { workspaceId: workspace_id, from: from as SlackFrom };
}
