import { createHmac } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CELUNE_SECRET_KEYS,
  findRepoRoot,
  InitError,
  mergeEnv,
  parseEnv,
  runInit,
  signHs256,
  supabaseApiKey,
} from '../init.js';

const here = dirname(fileURLToPath(import.meta.url));
const template = join(here, '../../../../docker/.env.example');

let root: string;

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'celune-init-'));
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages: []\n');
  mkdirSync(join(dir, 'packages/db/scripts'), { recursive: true });
  writeFileSync(join(dir, 'packages/db/scripts/boot-local.sh'), '#!/usr/bin/env bash\n');
  mkdirSync(join(dir, 'docker'), { recursive: true });
  copyFileSync(template, join(dir, 'docker/.env.example'));
  return dir;
}

const read = (rel: string) => parseEnv(readFileSync(join(root, rel), 'utf8'));

function verifyHs256(token: string, secret: string): Record<string, unknown> {
  const [head, body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  expect(sig).toBe(expected);
  return JSON.parse(Buffer.from(body!, 'base64url').toString('utf8'));
}

const link = {
  url: 'https://example.supabase.co/',
  anonKey: 'anon-test-key',
  serviceRoleKey: 'service-test-key',
  dbUrl: 'postgresql://postgres:pw@db.example.supabase.co:5432/postgres',
};

beforeEach(() => {
  root = makeRepo();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('signHs256 and supabaseApiKey', () => {
  it('signs a verifiable HS256 token with the role claim', () => {
    const now = 1_700_000_000;
    const token = supabaseApiKey('service_role', 'a'.repeat(64), now);
    const payload = verifyHs256(token, 'a'.repeat(64));
    expect(payload).toMatchObject({ role: 'service_role', iss: 'supabase', iat: now });
    expect(payload.exp).toBe(now + 10 * 365 * 24 * 60 * 60);
  });

  it('uses base64url segments', () => {
    expect(signHs256({ a: '???>>>' }, 'k')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });
});

describe('mergeEnv', () => {
  it('keeps comments and unrelated keys, replaces placeholders, appends missing keys', () => {
    const base = '# header\nKEEP=1\nSECRET=<generate: x>\nSET=old\n';
    const out = mergeEnv(base, [
      { key: 'SECRET', value: 'new', overwrite: false },
      { key: 'SET', value: 'ignored', overwrite: false },
      { key: 'EXTRA', value: 'x', overwrite: false },
    ]);
    expect(out.text).toBe(
      '# header\nKEEP=1\nSECRET=new\nSET=old\n\n# Added by celune init\nEXTRA=x\n',
    );
    expect(out.kept).toEqual(['SET']);
    expect(out.written).toEqual(['SECRET', 'EXTRA']);
  });

  it('parseEnv strips quotes and inline comments', () => {
    const env = parseEnv('A="x y"\nB=z   # note\nexport C=1\n');
    expect(env.get('A')).toBe('x y');
    expect(env.get('B')).toBe('z');
    expect(env.get('C')).toBe('1');
  });
});

describe('runInit docker mode', () => {
  it('ships every secret empty so the compose guards fail closed on a raw copy', () => {
    const env = parseEnv(readFileSync(template, 'utf8'));
    for (const key of [
      ...CELUNE_SECRET_KEYS,
      'POSTGRES_PASSWORD',
      'JWT_SECRET',
      'ANON_KEY',
      'SERVICE_ROLE_KEY',
      'SECRET_KEY_BASE',
      'REALTIME_DB_ENC_KEY',
    ]) {
      expect(env.get(key), key).toBe('');
    }
  });

  it('closes open sign-up by default in the env example and the compose file', () => {
    const env = parseEnv(readFileSync(template, 'utf8'));
    expect(env.get('DISABLE_SIGNUP')).toBe('true');
    const compose = readFileSync(join(template, '..', 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('GOTRUE_DISABLE_SIGNUP: ${DISABLE_SIGNUP:-true}');
    expect(compose).toContain('DB_ENC_KEY: ${REALTIME_DB_ENC_KEY:?');
    expect(compose).not.toContain('supabaserealtime');
  });

  it('fills every placeholder in docker/.env with crypto-random values', () => {
    const result = runInit({ root, mode: 'docker' });
    const env = read('docker/.env');

    for (const [key, value] of env) {
      expect(value.startsWith('<generate'), key).toBe(false);
    }
    for (const key of [...CELUNE_SECRET_KEYS, 'POSTGRES_PASSWORD', 'JWT_SECRET']) {
      expect(env.get(key), key).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(Buffer.from(env.get('SECRET_KEY_BASE')!, 'base64')).toHaveLength(48);
    expect(env.get('REALTIME_DB_ENC_KEY')).toMatch(/^[0-9a-f]{16}$/);
    expect(verifyHs256(env.get('ANON_KEY')!, env.get('JWT_SECRET')!).role).toBe('anon');
    expect(verifyHs256(env.get('SERVICE_ROLE_KEY')!, env.get('JWT_SECRET')!).role).toBe(
      'service_role',
    );
    expect(new Set(CELUNE_SECRET_KEYS.map((k) => env.get(k))).size).toBe(CELUNE_SECRET_KEYS.length);
    expect(result.migrated).toBe(false);
  });

  it('writes env files readable only by the owner', () => {
    runInit({ root, mode: 'docker' });
    for (const rel of ['docker/.env', 'apps/platform/.env.local', 'apps/api/.env']) {
      expect(statSync(join(root, rel)).mode & 0o777, rel).toBe(0o600);
    }
  });

  it('points the app env files at the stack with shared secrets', () => {
    runInit({ root, mode: 'docker' });
    const docker = read('docker/.env');
    const platform = read('apps/platform/.env.local');
    const api = read('apps/api/.env');

    expect(platform.get('NEXT_PUBLIC_SUPABASE_URL')).toBe('http://localhost:8000');
    expect(platform.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')).toBe(docker.get('ANON_KEY'));
    expect(api.get('SUPABASE_SERVICE_ROLE_KEY')).toBe(docker.get('SERVICE_ROLE_KEY'));
    expect(platform.get('CELUNE_EDITION')).toBe('community');
    expect(api.get('CELUNE_EDITION')).toBe('community');
    for (const key of ['PROVIDER_KEY_ENCRYPTION_KEY', 'JOB_HMAC_KEY', 'CELUNE_HOST_JWT_SECRET']) {
      expect(docker.get(key), key).toMatch(/^[0-9a-f]{64}$/);
      expect(platform.get(key), key).toBe(docker.get(key));
      expect(api.get(key), key).toBe(docker.get(key));
    }
  });

  it('is idempotent: a re-run changes no file and generates nothing', () => {
    runInit({ root, mode: 'docker' });
    const before = ['docker/.env', 'apps/platform/.env.local', 'apps/api/.env'].map((rel) =>
      readFileSync(join(root, rel), 'utf8'),
    );

    const second = runInit({ root, mode: 'docker' });

    const after = ['docker/.env', 'apps/platform/.env.local', 'apps/api/.env'].map((rel) =>
      readFileSync(join(root, rel), 'utf8'),
    );
    expect(after).toEqual(before);
    expect(second.generated).toEqual([]);
  });

  it('re-signs the API keys when the JWT secret is missing', () => {
    writeFileSync(
      join(root, 'docker/.env'),
      'JWT_SECRET=\nANON_KEY=stale\nSERVICE_ROLE_KEY=stale\n',
    );

    runInit({ root, mode: 'docker' });

    const env = read('docker/.env');
    expect(env.get('ANON_KEY')).not.toBe('stale');
    expect(verifyHs256(env.get('ANON_KEY')!, env.get('JWT_SECRET')!).role).toBe('anon');
  });

  it('never prints a secret value', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    runInit({ root, mode: 'docker', log: (l) => lines.push(l) });

    const printed = [...lines, ...spy.mock.calls.flat().map(String)].join('\n');
    const docker = read('docker/.env');
    for (const key of [
      ...CELUNE_SECRET_KEYS,
      'POSTGRES_PASSWORD',
      'JWT_SECRET',
      'ANON_KEY',
      'SERVICE_ROLE_KEY',
      'SECRET_KEY_BASE',
      'REALTIME_DB_ENC_KEY',
    ]) {
      expect(printed.includes(docker.get(key)!), key).toBe(false);
    }
    expect(printed).toContain('PROVIDER_KEY_ENCRYPTION_KEY');
  });
});

describe('runInit supabase mode', () => {
  it('writes app env files, keeps existing secrets and keys, and runs migrations', () => {
    mkdirSync(join(root, 'apps/platform'), { recursive: true });
    writeFileSync(
      join(root, 'apps/platform/.env.local'),
      'SLACK_CLIENT_ID=abc\nPROVIDER_KEY_ENCRYPTION_KEY=' + 'b'.repeat(64) + '\n',
    );
    const runner = vi.fn().mockReturnValue(true);

    const result = runInit({ root, mode: 'supabase', supabase: link, runMigrations: runner });

    const platform = read('apps/platform/.env.local');
    const api = read('apps/api/.env');
    expect(platform.get('SLACK_CLIENT_ID')).toBe('abc');
    expect(platform.get('PROVIDER_KEY_ENCRYPTION_KEY')).toBe('b'.repeat(64));
    expect(api.get('PROVIDER_KEY_ENCRYPTION_KEY')).toBe('b'.repeat(64));
    expect(platform.get('NEXT_PUBLIC_SUPABASE_URL')).toBe('https://example.supabase.co');
    expect(api.get('SUPABASE_URL')).toBe('https://example.supabase.co');
    expect(api.get('SUPABASE_SERVICE_ROLE_KEY')).toBe('service-test-key');
    expect(platform.get('CREDENTIAL_ENCRYPTION_KEY')).toMatch(/^[0-9a-f]{64}$/);
    expect(runner).toHaveBeenCalledWith(root, link.dbUrl);
    expect(result.migrated).toBe(true);
    expect(result.generated).not.toContain('PROVIDER_KEY_ENCRYPTION_KEY');
  });

  it('does not write docker/.env', () => {
    runInit({ root, mode: 'supabase', supabase: link, skipMigrations: true });
    expect(() => statSync(join(root, 'docker/.env'))).toThrow();
  });

  it('skips migrations on request', () => {
    const runner = vi.fn();
    const result = runInit({
      root,
      mode: 'supabase',
      supabase: link,
      skipMigrations: true,
      runMigrations: runner,
    });
    expect(runner).not.toHaveBeenCalled();
    expect(result.migrated).toBe(false);
  });

  it('fails when migrations fail', () => {
    expect(() =>
      runInit({ root, mode: 'supabase', supabase: link, runMigrations: () => false }),
    ).toThrow(InitError);
  });

  it('rejects malformed connection values without echoing them', () => {
    const bad = { ...link, dbUrl: 'mysql://secret-value' };
    expect(() => runInit({ root, mode: 'supabase', supabase: bad })).toThrow(
      /^Database URL must start with/,
    );
    try {
      runInit({ root, mode: 'supabase', supabase: bad });
    } catch (err) {
      expect((err as Error).message).not.toContain('secret-value');
    }
    expect(() =>
      runInit({ root, mode: 'supabase', supabase: { ...link, serviceRoleKey: ' ' } }),
    ).toThrow(/service role key is required/);
  });
});

describe('findRepoRoot', () => {
  it('finds the root from a nested directory', () => {
    const nested = join(root, 'apps/platform/src');
    mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(root);
  });

  it('fails outside a Celune clone', () => {
    const outside = mkdtempSync(join(tmpdir(), 'celune-none-'));
    expect(() => findRepoRoot(outside)).toThrow(InitError);
    rmSync(outside, { recursive: true, force: true });
  });
});
