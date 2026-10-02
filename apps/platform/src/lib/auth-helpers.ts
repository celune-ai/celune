const LAST_PROVIDER_KEY = 'last_auth_provider';

export function getLastProvider(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LAST_PROVIDER_KEY);
}

export function setLastProvider(provider: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAST_PROVIDER_KEY, provider);
  }
}

export function isRateLimitError(message: string, status?: number): boolean {
  if (status === 429) return true;
  const lower = message.toLowerCase();
  return lower.includes('rate') || lower.includes('too many') || lower.includes('429');
}

/**
 * Extract the retry-after seconds from a Supabase rate limit error message.
 * Messages look like "...try again after 58 seconds" or similar.
 * Returns a sensible default if unparseable.
 */
export function parseRetryAfterSeconds(message: string): number {
  const match = message.match(/(\d+)\s*second/i);
  if (match) return Math.max(parseInt(match[1], 10), 5);
  return 60;
}
