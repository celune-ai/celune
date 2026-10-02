/**
 * Auth pages where 401 interceptor should NOT trigger a redirect.
 */
const AUTH_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/check-email',
  '/auth/callback',
];

function isAuthPage(): boolean {
  if (typeof window === 'undefined') return false;
  return AUTH_PATHS.some((p) => window.location.pathname.startsWith(p));
}

/**
 * Debounce flag so multiple simultaneous 401s don't trigger multiple redirects.
 */
let sessionExpiredRedirectPending = false;

/**
 * Redirect to /login with a session_expired reason.
 * Debounced so that rapid parallel 401s only trigger one redirect.
 */
function handleSessionExpired(): void {
  if (sessionExpiredRedirectPending || isAuthPage()) return;
  sessionExpiredRedirectPending = true;
  const url = new URL('/login', window.location.origin);
  url.searchParams.set('reason', 'session_expired');
  window.location.href = url.toString();
}

/**
 * Wrapper around fetch() that throws on non-2xx responses before parsing JSON.
 * Prevents silent failures where a 4xx/5xx error body gets parsed as data.
 *
 * On 401 responses, redirects to /login with a session_expired reason
 * (unless already on an auth page). Multiple simultaneous 401s are debounced.
 *
 * On 403 responses with `error: 'plan_limit'`, throws a PlanLimitError
 * so callers can show contextual upgrade prompts.
 */
/** @internal Reset debounce flag — exposed only for tests. */
export function _resetSessionExpiredFlag(): void {
  sessionExpiredRedirectPending = false;
}

export async function fetchJson<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    if (res.status === 401) {
      handleSessionExpired();
    }
    // Check for plan limit errors (403 with error: 'plan_limit')
    if (res.status === 403) {
      const { parsePlanLimitResponse, PlanLimitError } = await import('./plan-limit-error');
      const payload = await parsePlanLimitResponse(res);
      if (payload) {
        throw new PlanLimitError(payload);
      }
    }
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return res.json() as Promise<T>;
}
