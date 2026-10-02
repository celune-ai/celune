/**
 * PBKDF2-SHA256 password hashing utility.
 * Uses Node.js Web Crypto API (crypto.subtle) — available in Next.js API routes.
 * Compatible with Edge Function implementation.
 */

// Constants (must match Edge Function)
export const PBKDF2_ITERATIONS = 100_000;
export const SALT_BYTES = 16;
export const KEY_BYTES = 32;

/**
 * Convert ArrayBuffer to hex string.
 */
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert hex string to Uint8Array.
 */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Generate a random salt.
 */
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/**
 * Hash a password with the given salt using PBKDF2-SHA256.
 * @param password Plain-text password
 * @param salt Salt bytes
 * @returns Hex-encoded hash
 */
async function pbkdf2Hash(password: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BYTES * 8,
  );
  return toHex(derivedBits);
}

/**
 * Generate a storable password hash.
 * @param password Plain-text password
 * @returns String in format `{hex-salt}:{hex-hash}`
 */
export async function createPasswordHash(password: string): Promise<string> {
  const salt = generateSalt();
  const hash = await pbkdf2Hash(password, salt);
  return `${toHex(salt.buffer as ArrayBuffer)}:${hash}`;
}

/**
 * Verify a plaintext password against a stored hash string.
 * @param password Plain-text password to verify
 * @param stored Stored hash string in format `{hex-salt}:{hex-hash}`
 * @returns True if password matches, false otherwise
 */
export async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = fromHex(saltHex);
  const computed = await pbkdf2Hash(password, salt);

  // Constant-time comparison to prevent timing attacks
  if (computed.length !== hashHex.length) return false;

  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }

  return diff === 0;
}
