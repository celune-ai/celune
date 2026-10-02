import { describe, it, expect, vi, afterEach } from 'vitest';

async function loadWithPrefix(prefix?: string) {
  vi.resetModules();
  if (prefix === undefined) vi.stubEnv('CELUNE_API_KEY_PREFIX', '');
  else vi.stubEnv('CELUNE_API_KEY_PREFIX', prefix);
  return import('../api-keys');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('api key prefix', () => {
  it('defaults to the celune prefix so existing keys keep working', async () => {
    const mod = await loadWithPrefix();
    const { key, prefix } = mod.generateApiKey('live');
    expect(key.startsWith('celune_live_')).toBe(true);
    expect(prefix).toHaveLength(14);
    expect(mod.parseKeyEnvironment('celune_test_abc')).toBe('test');
    expect(mod.API_KEY_BEARER_PREFIX).toBe('celune_');
  });

  it('reads CELUNE_API_KEY_PREFIX for generation, parsing, and the stored prefix', async () => {
    const mod = await loadWithPrefix('acme');
    const { key, prefix } = mod.generateApiKey('test');
    expect(key.startsWith('acme_test_')).toBe(true);
    expect(prefix).toBe(key.slice(0, 12));
    expect(mod.parseKeyEnvironment(key)).toBe('test');
    expect(mod.parseKeyEnvironment('celune_live_abc')).toBeNull();
  });
});
