import type { Gate, GateFeature } from '@celuneai/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../testing/index.ts';

const WS = '11111111-1111-4111-8111-111111111111';
const DENIAL = {
  error: 'subscription_required',
  message: 'This organization needs a Celune Cloud subscription.',
  upgrade_url: '/subscribe',
};

/** Denies workspace.access with 402 the way the hosted paywall does; allows everything else. */
function paywallGate(asked: GateFeature[]): Gate {
  return {
    async check(feature) {
      asked.push(feature);
      if (feature !== 'workspace.access') return { allowed: true };
      return { allowed: false, reason: 'subscription_required', status: 402, details: DENIAL };
    },
  };
}

let api: TestApi;
let token: string;
let asked: GateFeature[];

beforeEach(async () => {
  asked = [];
  api = await createTestApi({ gate: paywallGate(asked) });
  token = (await api.addKey({ workspaceId: WS, userId: 'user-1' })).raw;
});

describe('workspace.access gate', () => {
  it('refuses reads over v1 with the gate status and body', async () => {
    const res = await api.request('/tasks', { token });

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual(DENIAL);
    expect(asked).toEqual(['workspace.access']);
  });

  it('refuses writes before any service runs', async () => {
    const res = await api.request('/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Blocked' }),
      token,
    });

    expect(res.status).toBe(402);
    expect(asked).toEqual(['workspace.access']);
  });

  it('refuses MCP calls', async () => {
    const res = await api.request('/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      token,
    });

    expect(res.status).toBe(402);
  });

  it('lets requests through when the gate allows the workspace', async () => {
    const open = await createTestApi();
    const openToken = (await open.addKey({ workspaceId: WS })).raw;

    expect((await open.request('/tasks', { token: openToken })).status).toBe(200);
  });
});
