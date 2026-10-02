import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSafeApiUrl,
  loadHarnessConfig,
  PROBE_TASK_ID,
  runHarnessCheck,
  storedKeyAllowed,
} from '../connect/check.js';

const KEY = 'test-server-key';
const clock = () => new Date('2026-09-27T12:00:00Z');

function reply(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('runHarnessCheck with a mocked fetch', () => {
  it('posts a queued probe event with the credential and treats task-not-found as success', async () => {
    const fetchImpl = reply(404, { error: 'Resource not found' });
    const result = await runHarnessCheck({
      apiUrl: 'http://celune.test/',
      harness: 'acme',
      credential: KEY,
      fetchImpl,
      clock,
    });
    expect(result).toMatchObject({
      ok: true,
      status: 404,
      url: 'http://celune.test/v1/harness/events',
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://celune.test/v1/harness/events');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({
      event_id: `celune-connect-check:${clock().getTime().toString(36)}`,
      task_id: PROBE_TASK_ID,
      harness: 'acme',
      run_id: 'celune-connect-check',
      status: 'queued',
      occurred_at: '2026-09-27T12:00:00.000Z',
    });
  });

  it('reports a missing route, a refused key, and a read-only key without echoing the key', async () => {
    const base = { apiUrl: 'http://celune.test', harness: 'acme', credential: KEY, clock };
    const missing = await runHarnessCheck({
      ...base,
      fetchImpl: reply(404, { error: 'Not found' }),
    });
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain('No harness event route');

    const refused = await runHarnessCheck({
      ...base,
      fetchImpl: reply(401, { error: 'Unauthorized' }),
    });
    expect(refused).toMatchObject({ ok: false, status: 401 });

    const readOnly = await runHarnessCheck({
      ...base,
      fetchImpl: reply(403, { error: 'Write scope required' }),
    });
    expect(readOnly.message).toContain('Write scope required');

    for (const r of [missing, refused, readOnly]) expect(r.message).not.toContain(KEY);
  });

  it('reports an unreachable server', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const result = await runHarnessCheck({
      apiUrl: 'http://celune.test',
      harness: 'acme',
      credential: KEY,
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, status: null });
    expect(result.message).toContain('ECONNREFUSED');
  });
});

describe('runHarnessCheck against a local API', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  it('passes with the right key and fails with a wrong one', async () => {
    const seen: Array<Record<string, unknown>> = [];
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.method !== 'POST' || req.url !== '/v1/harness/events') {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Not found' }));
        }
        if (req.headers.authorization !== `Bearer ${KEY}`) {
          res.statusCode = 401;
          return res.end(JSON.stringify({ error: 'Unauthorized' }));
        }
        seen.push(JSON.parse(raw) as Record<string, unknown>);
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Resource not found' }));
      });
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const good = await runHarnessCheck({ apiUrl, harness: 'acme', credential: KEY });
    expect(good.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ task_id: PROBE_TASK_ID, harness: 'acme', status: 'queued' });

    const bad = await runHarnessCheck({ apiUrl, harness: 'acme', credential: 'wrong' });
    expect(bad).toMatchObject({ ok: false, status: 401 });

    const wrongPath = await runHarnessCheck({
      apiUrl: `${apiUrl}/api`,
      harness: 'acme',
      credential: KEY,
    });
    expect(wrongPath.message).toContain('No harness event route');
  });
});

describe('loadHarnessConfig', () => {
  it('reads .celune/harness.json and rejects a missing or incomplete file', () => {
    const root = mkdtempSync(join(tmpdir(), 'celune-connect-config-'));
    try {
      expect(() => loadHarnessConfig(root)).toThrow(/No \.celune\/harness\.json/);
      mkdirSync(join(root, '.celune'));
      writeFileSync(join(root, '.celune/harness.json'), JSON.stringify({ harness: 'acme' }));
      expect(() => loadHarnessConfig(root)).toThrow(/apiUrl/);
      writeFileSync(
        join(root, '.celune/harness.json'),
        JSON.stringify({
          harness: 'acme',
          apiUrl: 'http://localhost:4000',
          credentialEnv: 'ACME_KEY',
        }),
      );
      expect(loadHarnessConfig(root)).toMatchObject({ harness: 'acme', credentialEnv: 'ACME_KEY' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('credential destination guards', () => {
  it('allows https anywhere and http only on loopback', () => {
    expect(isSafeApiUrl('https://celune.example.com')).toBe(true);
    expect(isSafeApiUrl('http://localhost:8787')).toBe(true);
    expect(isSafeApiUrl('http://127.0.0.1:8787')).toBe(true);
    expect(isSafeApiUrl('http://celune.example.com')).toBe(false);
    expect(isSafeApiUrl('not a url')).toBe(false);
  });

  it('sends the saved key only to the origin it was saved for', () => {
    const saved = ['https://app.celune.ai', 'https://app.celune.ai/api/mcp'];
    expect(storedKeyAllowed('https://app.celune.ai/', saved)).toBe(true);
    expect(storedKeyAllowed('https://attacker.example', saved)).toBe(false);
    expect(storedKeyAllowed('https://app.celune.ai.attacker.example', saved)).toBe(false);
    expect(storedKeyAllowed('http://app.celune.ai', saved)).toBe(false);
  });
});
