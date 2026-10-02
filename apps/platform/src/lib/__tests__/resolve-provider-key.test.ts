import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Gate } from '@celuneai/core';
import { resolveProviderKey, ProviderKeyRequiredError } from '../resolve-provider-key';

// Mock createServiceClient
const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
const mockUpdateEq = vi.fn(() => ({
  then: vi.fn((cb: (v: { error: null }) => void) => cb({ error: null })),
}));
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
const mockEq = vi.fn(() => ({
  eq: mockEq,
  is: mockIs,
  maybeSingle: mockMaybeSingle,
  single: mockSingle,
}));
const mockIs = vi.fn(() => ({ eq: mockEq, maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn((table: string) => {
  // touchLastUsed calls .from().update().eq()
  if (table === 'provider_api_keys') {
    return { select: mockSelect, update: mockUpdate };
  }
  return { select: mockSelect };
});

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}));

// Mock decryptProviderKey
vi.mock('@/lib/provider-key-crypto', () => ({
  decryptProviderKey: vi.fn((encrypted: string) => {
    if (encrypted === 'FAIL') throw new Error('Decryption failed');
    return `decrypted-${encrypted}`;
  }),
}));

// Mock isPlatformOwner
const mockIsPlatformOwner = vi.fn<(userId: string) => Promise<boolean>>().mockResolvedValue(false);
vi.mock('@/lib/plan-enforcement', () => ({
  isPlatformOwner: (userId: string) => mockIsPlatformOwner(userId),
}));

// Edition is mutable per test
const mockHostConfig = vi.hoisted(() => ({ edition: 'cloud' as 'cloud' | 'community' }));
vi.mock('@/lib/host-config', () => ({ hostConfig: mockHostConfig }));

// Platform gate is mutable per test
const mockGateCheck = vi.fn();
vi.mock('@/lib/gate', () => ({
  createPlatformGate: () => ({ check: mockGateCheck }),
}));

// Budget assertion is mutable per test
const mockAssertBudget = vi.fn();
vi.mock('@/lib/ai-budget', () => ({
  assertWorkspaceAiBudget: (workspaceId: string) => mockAssertBudget(workspaceId),
}));

describe('resolveProviderKey', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHostConfig.edition = 'cloud';
    mockGateCheck.mockResolvedValue({ allowed: true });
    mockAssertBudget.mockResolvedValue(undefined);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
  });

  it('returns workspace key when present', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'ws-key-1', encrypted_key: 'ws-enc', key_iv: 'ws-iv' },
      error: null,
    });

    const result = await resolveProviderKey('anthropic', 'org-1', 'ws-1');

    expect(result).toEqual({
      key: 'decrypted-ws-enc',
      source: 'user_workspace',
      keyId: 'ws-key-1',
    });
    expect(mockAssertBudget).toHaveBeenCalledWith('ws-1');
  });

  it('falls through to org key when no workspace key', async () => {
    // Workspace query returns nothing
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    // Org query returns a key
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'org-key-1', encrypted_key: 'org-enc', key_iv: 'org-iv' },
      error: null,
    });

    const result = await resolveProviderKey('openai', 'org-1', 'ws-1');

    expect(result).toEqual({
      key: 'decrypted-org-enc',
      source: 'user_org',
      keyId: 'org-key-1',
    });
  });

  it('falls through to platform env var for platform owner', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockIsPlatformOwner.mockResolvedValueOnce(true);
    process.env.ANTHROPIC_API_KEY = 'sk-platform-key';

    const result = await resolveProviderKey('anthropic', 'org-1', 'ws-1', { userId: 'owner-1' });

    expect(result).toEqual({
      key: 'sk-platform-key',
      source: 'platform',
    });
    expect(mockGateCheck).not.toHaveBeenCalled();
  });

  it('falls through to trial key when the gate allows provider.fallback_key', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    process.env.ANTHROPIC_API_KEY = 'sk-platform-key';

    const result = await resolveProviderKey('anthropic', 'org-1', 'ws-1', { userId: 'user-1' });

    expect(result).toEqual({
      key: 'sk-platform-key',
      source: 'trial',
    });
    expect(mockGateCheck).toHaveBeenCalledWith(
      'provider.fallback_key',
      expect.objectContaining({
        scope: expect.objectContaining({ workspaceId: 'ws-1', orgId: 'org-1' }),
        userId: 'user-1',
      }),
    );
  });

  it('accepts an injected gate', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    process.env.ANTHROPIC_API_KEY = 'sk-platform-key';
    const gate: Gate = { check: vi.fn().mockResolvedValue({ allowed: true }) };

    const result = await resolveProviderKey('anthropic', 'org-1', 'ws-1', { gate });

    expect(result.source).toBe('trial');
    expect(gate.check).toHaveBeenCalledTimes(1);
    expect(mockGateCheck).not.toHaveBeenCalled();
  });

  it('throws ProviderKeyRequiredError when the gate reports trial exhausted', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockGateCheck.mockResolvedValue({ allowed: false, reason: 'trial_exhausted', status: 402 });
    process.env.ANTHROPIC_API_KEY = 'sk-platform-key';

    const err = await resolveProviderKey('anthropic', 'org-1', 'ws-1', { userId: 'user-1' }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ProviderKeyRequiredError);
    expect(err).toMatchObject({ trialExhausted: true, reason: 'trial_exhausted' });
    expect((err as Error).message).toContain('Starter token budget used up');
  });

  it('carries a non-trial gate reason without claiming the trial ended', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockGateCheck.mockResolvedValue({ allowed: false, reason: 'workspace_suspended', status: 403 });
    process.env.ANTHROPIC_API_KEY = 'sk-platform-key';

    const err = await resolveProviderKey('anthropic', 'org-1', 'ws-1', { userId: 'user-1' }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ProviderKeyRequiredError);
    expect(err).toMatchObject({ trialExhausted: false, reason: 'workspace_suspended' });
  });

  it('never uses host env keys on the community edition', async () => {
    mockHostConfig.edition = 'community';
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockIsPlatformOwner.mockResolvedValue(true);
    process.env.ANTHROPIC_API_KEY = 'sk-platform-key';

    const err = await resolveProviderKey('anthropic', 'org-1', 'ws-1', {
      userId: 'owner-1',
      skipByokGate: true,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderKeyRequiredError);
    expect(err).toMatchObject({ trialExhausted: false, provider: 'anthropic' });
    expect(mockGateCheck).not.toHaveBeenCalled();
    expect(mockIsPlatformOwner).not.toHaveBeenCalled();
  });

  it('still returns BYOK keys on the community edition', async () => {
    mockHostConfig.edition = 'community';
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'ws-key-1', encrypted_key: 'ws-enc', key_iv: 'ws-iv' },
      error: null,
    });

    const result = await resolveProviderKey('anthropic', 'org-1', 'ws-1');

    expect(result.source).toBe('user_workspace');
  });

  it('throws when the cloud edition has no host key configured', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(resolveProviderKey('anthropic', 'org-1', 'ws-1')).rejects.toThrow(
      'No API key available for provider "anthropic"',
    );
  });

  it('propagates a budget failure before touching any key', async () => {
    mockAssertBudget.mockRejectedValueOnce(new Error('over budget'));

    await expect(resolveProviderKey('anthropic', 'org-1', 'ws-1')).rejects.toThrow('over budget');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('falls through when workspace key decryption fails', async () => {
    // Workspace key with bad data
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'ws-key-bad', encrypted_key: 'FAIL', key_iv: 'iv' },
      error: null,
    });
    // Org key is fine
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'org-key-1', encrypted_key: 'org-enc', key_iv: 'org-iv' },
      error: null,
    });

    const result = await resolveProviderKey('openai', 'org-1', 'ws-1');

    expect(result.source).toBe('user_org');
  });

  it('skips workspace lookup and budget check when workspaceId is not provided', async () => {
    // Only org query
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'org-key-1', encrypted_key: 'org-enc', key_iv: 'org-iv' },
      error: null,
    });

    const result = await resolveProviderKey('elevenlabs', 'org-1');

    expect(result.source).toBe('user_org');
    // select() should be called once (org query only), not twice (no workspace query)
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockAssertBudget).not.toHaveBeenCalled();
  });
});
