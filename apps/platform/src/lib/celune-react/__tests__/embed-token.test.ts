import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMBED_TOKEN_RETRY_MS,
  EmbedTokenDenied,
  mintEmbedToken,
  mintWithSessionRetry,
  startEmbedTokenRenewal,
  type EmbedToken,
} from '../embed-token';

const WS = 'ws-1';
const ok = (token: string): EmbedToken => ({ workspaceId: WS, token, expiresIn: 600 });

describe('startEmbedTokenRenewal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries a failed mint with backoff and never reports a null token', async () => {
    const results: Array<EmbedToken | null> = [null, null, ok('t1')];
    const getToken = vi.fn(async () => results.shift() ?? null);
    const onToken = vi.fn();
    const stop = startEmbedTokenRenewal(getToken, onToken);

    await vi.advanceTimersByTimeAsync(0);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(onToken).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(EMBED_TOKEN_RETRY_MS[0]);
    expect(getToken).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(EMBED_TOKEN_RETRY_MS[1]);
    expect(getToken).toHaveBeenCalledTimes(3);
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith(ok('t1'));
    stop();
  });

  it('stops for good on a 402 or 403 denial and reports it', async () => {
    const getToken = vi.fn(async () => {
      throw new EmbedTokenDenied(402);
    });
    const onToken = vi.fn();
    const onDenied = vi.fn();
    startEmbedTokenRenewal(getToken, onToken, onDenied);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(onDenied).toHaveBeenCalledWith(402);
    expect(onToken).not.toHaveBeenCalled();
  });

  it('renews a minute before expiry and stops cleanly', async () => {
    const getToken = vi.fn(async () => ok('t'));
    const stop = startEmbedTokenRenewal(getToken, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(540_000);
    expect(getToken).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(getToken).toHaveBeenCalledTimes(2);
  });
});

describe('mintWithSessionRetry', () => {
  it('refreshes the session once after a failed mint', async () => {
    const mint = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(ok('t2'));
    const refreshSession = vi.fn(async () => ({ error: null }));
    expect(await mintWithSessionRetry(WS, refreshSession, mint)).toEqual(ok('t2'));
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('gives up when the session cannot be renewed', async () => {
    const mint = vi.fn(async () => null);
    const refreshSession = vi.fn(async () => ({ error: new Error('expired') }));
    expect(await mintWithSessionRetry(WS, refreshSession, mint)).toBeNull();
    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe('mintEmbedToken denials', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([402, 403])('throws EmbedTokenDenied on %i', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status })),
    );
    await expect(mintEmbedToken(WS)).rejects.toMatchObject({ name: 'EmbedTokenDenied', status });
  });

  it('treats other failures as transient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await mintEmbedToken(WS)).toBeNull();
    warn.mockRestore();
  });

  it('skips the session retry and rethrows a denial', async () => {
    const mint = vi.fn(async () => {
      throw new EmbedTokenDenied(402);
    });
    const refreshSession = vi.fn(async () => ({ error: null }));
    await expect(mintWithSessionRetry(WS, refreshSession, mint)).rejects.toBeInstanceOf(
      EmbedTokenDenied,
    );
    expect(mint).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });
});
