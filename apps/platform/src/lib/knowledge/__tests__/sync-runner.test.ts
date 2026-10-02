import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../sync-runner';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValueOnce('ok');
    const result = await withRetry(fn, 'test');
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail1')).mockResolvedValueOnce('ok');
    const result = await withRetry(fn, 'test', { baseDelayMs: 1, maxRetries: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, 'test', { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow(
      'always fails',
    );
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('uses exponential backoff', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      // Execute immediately
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const failFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValueOnce('ok');

    await withRetry(failFn, 'test', { baseDelayMs: 100, maxRetries: 3 });

    // First retry: 100ms, second retry: 200ms
    expect(delays[0]).toBe(100);
    expect(delays[1]).toBe(200);

    vi.restoreAllMocks();
  });

  it('caps delay at maxDelayMs', async () => {
    const delays: number[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const failFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'))
      .mockResolvedValueOnce('ok');

    await withRetry(failFn, 'test', { baseDelayMs: 10000, maxDelayMs: 5000, maxRetries: 4 });

    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(5000);
    }

    vi.restoreAllMocks();
  });
});
