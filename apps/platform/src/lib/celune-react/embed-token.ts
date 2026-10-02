import { apiUrl } from '@repo/db/api';

export interface EmbedToken {
  workspaceId: string;
  token: string;
  expiresIn: number;
}

/**
 * The host refused the workspace for good: 402 (no plan, the paywall) or 403 (no
 * access). Retrying cannot help, so renewal stops and the UI shows the locked state.
 */
export class EmbedTokenDenied extends Error {
  readonly status: 402 | 403;

  constructor(status: 402 | 403) {
    super(`embed token denied with ${status}`);
    this.name = 'EmbedTokenDenied';
    this.status = status;
  }
}

/** Delays between failed renewals; the last one repeats until a mint succeeds. */
export const EMBED_TOKEN_RETRY_MS = [5_000, 15_000, 60_000];

/** Trades the session cookie for a short-lived host JWT scoped to one workspace. */
export async function mintEmbedToken(workspaceId: string): Promise<EmbedToken | null> {
  const res = await fetch(
    apiUrl(`/api/embed/token?workspace_id=${encodeURIComponent(workspaceId)}`),
    { method: 'POST' },
  );
  if (res.status === 402 || res.status === 403) throw new EmbedTokenDenied(res.status);
  if (!res.ok) {
    console.warn(`[celune] embed token request failed with ${res.status}`);
    return null;
  }
  const body = (await res.json()) as { token?: string; expires_in?: number };
  if (!body.token) return null;
  return { workspaceId, token: body.token, expiresIn: body.expires_in ?? 600 };
}

/** Rethrows a denial; any other error counts as a transient failure. */
function transientAsNull(error: unknown): null {
  if (error instanceof EmbedTokenDenied) throw error;
  return null;
}

/**
 * Mints once; on failure renews the session (it may have lapsed) and tries again.
 * A denial (402 or 403) throws EmbedTokenDenied at once, without a session retry.
 */
export async function mintWithSessionRetry(
  workspaceId: string,
  refreshSession: () => Promise<{ error: unknown }>,
  mint: (workspaceId: string) => Promise<EmbedToken | null> = mintEmbedToken,
): Promise<EmbedToken | null> {
  const first = await mint(workspaceId).catch(transientAsNull);
  if (first) return first;
  const { error } = await refreshSession();
  if (error) return null;
  return mint(workspaceId).catch(transientAsNull);
}

/**
 * Mints now, renews a minute before expiry, and retries failures with
 * backoff. A failure never clears the last token: a stale token 401s into
 * the provider's refresh and its reconnect banner instead of idling the hooks.
 * A denial (402 or 403) is terminal: renewal stops and onDenied is called.
 * Returns a stop function.
 */
export function startEmbedTokenRenewal(
  getToken: () => Promise<EmbedToken | null>,
  onToken: (token: EmbedToken) => void,
  onDenied: (status: 402 | 403) => void = () => {},
): () => void {
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    let next: EmbedToken | null;
    try {
      next = await getToken();
    } catch (error) {
      if (stopped) return;
      if (error instanceof EmbedTokenDenied) {
        onDenied(error.status);
        return;
      }
      next = null;
    }
    if (stopped) return;
    if (next) {
      attempt = 0;
      onToken(next);
      timer = setTimeout(run, Math.max(30, next.expiresIn - 60) * 1000);
      return;
    }
    const delay = EMBED_TOKEN_RETRY_MS[Math.min(attempt, EMBED_TOKEN_RETRY_MS.length - 1)];
    attempt += 1;
    timer = setTimeout(run, delay);
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
