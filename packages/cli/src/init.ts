/**
 * `celune init`: configure a self-hosted Celune.
 *
 * Two modes:
 * - supabase: link an existing Supabase project (URL, anon key, service role
 *   key, database URL), apply the repo migrations with boot-local.sh, and
 *   write the app env files.
 * - docker: write docker/.env for the compose stack with generated Supabase
 *   and Celune secrets, plus app env files pointed at the stack for local dev.
 *
 * Secrets are generated with node:crypto and written only to env files
 * (mode 0600). Nothing here logs a value; log lines name keys and files.
 * Re-running keeps every secret that is already set, so encryption keys are
 * never rotated by accident.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cliCommand } from './invocation.js';

export type InitMode = 'docker' | 'supabase';

export interface SupabaseLink {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
}

export type MigrationRunner = (root: string, dbUrl: string) => boolean;

export interface InitOptions {
  root: string;
  mode: InitMode;
  siteUrl?: string;
  supabase?: SupabaseLink;
  skipMigrations?: boolean;
  runMigrations?: MigrationRunner;
  log?: (line: string) => void;
}

export interface InitResult {
  files: string[];
  generated: string[];
  kept: string[];
  migrated: boolean;
}

export class InitError extends Error {}

/** Celune secrets shared by the web app and the API (32 random bytes, hex). */
export const CELUNE_SECRET_KEYS = [
  'PROVIDER_KEY_ENCRYPTION_KEY',
  'JOB_HMAC_KEY',
  'CREDENTIAL_ENCRYPTION_KEY',
  'CELUNE_HOST_JWT_SECRET',
  'WEBHOOK_ENCRYPTION_KEY',
  'CRON_SECRET',
  'HOOK_SECRET',
] as const;

const API_SECRET_KEYS = [
  'PROVIDER_KEY_ENCRYPTION_KEY',
  'JOB_HMAC_KEY',
  'CELUNE_HOST_JWT_SECRET',
] as const;

const TEN_YEARS_S = 10 * 365 * 24 * 60 * 60;

// ── Env files ──────────────────────────────────────────────────────────────

export function isUnset(value: string | undefined): boolean {
  if (value === undefined) return true;
  const v = value.trim();
  return v === '' || v.startsWith('<generate');
}

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const comment = value.search(/\s#/);
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    out.set(key, value);
  }
  return out;
}

export interface EnvUpdate {
  key: string;
  value: string;
  /** Replace a value that is already set. Secrets use false so re-runs keep them. */
  overwrite: boolean;
}

/**
 * Apply updates to env file text. Lines for other keys and comments stay as
 * they are; keys missing from the text are appended at the end.
 */
export function mergeEnv(
  base: string,
  updates: EnvUpdate[],
): { text: string; written: string[]; kept: string[] } {
  const byKey = new Map(updates.map((u) => [u.key, u]));
  const handled = new Set<string>();
  const written: string[] = [];
  const kept: string[] = [];

  const lines = base.split(/\r?\n/).map((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match) return line;
    const key = match[1]!;
    const update = byKey.get(key);
    if (!update || handled.has(key)) return line;
    handled.add(key);
    const current = parseEnv(line).get(key);
    if (!update.overwrite && !isUnset(current)) {
      kept.push(key);
      return line;
    }
    written.push(key);
    return `${key}=${update.value}`;
  });

  const missing = updates.filter((u) => !handled.has(u.key));
  if (missing.length > 0) {
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    if (lines.length > 0) lines.push('');
    lines.push('# Added by celune init');
    for (const u of missing) {
      lines.push(`${u.key}=${u.value}`);
      written.push(u.key);
    }
  }
  return { text: `${lines.join('\n').replace(/\n+$/, '')}\n`, written, kept };
}

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function writeSecretFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

// ── Secrets ────────────────────────────────────────────────────────────────

export function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function signHs256(payload: Record<string, unknown>, secret: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function supabaseApiKey(
  role: 'anon' | 'service_role',
  jwtSecret: string,
  now = Math.floor(Date.now() / 1000),
): string {
  return signHs256({ role, iss: 'supabase', iat: now, exp: now + TEN_YEARS_S }, jwtSecret);
}

/** First set value for `key` across env maps, else a fresh random value. */
function pickOrGenerate(
  key: string,
  sources: Array<Map<string, string>>,
  generated: string[],
  make: () => string = () => randomHex(32),
): string {
  for (const source of sources) {
    const value = source.get(key);
    if (!isUnset(value)) return value!;
  }
  generated.push(key);
  return make();
}

// ── Repo layout ────────────────────────────────────────────────────────────

export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (
      existsSync(join(dir, 'pnpm-workspace.yaml')) &&
      existsSync(join(dir, 'packages/db/scripts/boot-local.sh'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new InitError(
        `Run ${cliCommand()} init inside a clone of the Celune repository (no pnpm-workspace.yaml with packages/db found above this directory).`,
      );
    }
    dir = parent;
  }
}

export function paths(root: string) {
  return {
    dockerEnv: join(root, 'docker/.env'),
    dockerTemplate: join(root, 'docker/.env.example'),
    platformEnv: join(root, 'apps/platform/.env.local'),
    apiEnv: join(root, 'apps/api/.env'),
    bootScript: join(root, 'packages/db/scripts/boot-local.sh'),
  };
}

// ── Validation ─────────────────────────────────────────────────────────────

export function validateSupabaseLink(link: Partial<SupabaseLink>): SupabaseLink {
  const url = link.url?.trim() ?? '';
  if (!/^https?:\/\/[^\s]+$/.test(url)) {
    throw new InitError('Supabase URL must start with http:// or https://');
  }
  const dbUrl = link.dbUrl?.trim() ?? '';
  if (!/^postgres(ql)?:\/\/\S+$/.test(dbUrl)) {
    throw new InitError('Database URL must start with postgresql:// or postgres://');
  }
  for (const [label, value] of [
    ['anon key', link.anonKey],
    ['service role key', link.serviceRoleKey],
  ] as const) {
    if (!value || !value.trim()) throw new InitError(`Supabase ${label} is required`);
  }
  return {
    url: url.replace(/\/+$/, ''),
    anonKey: link.anonKey!.trim(),
    serviceRoleKey: link.serviceRoleKey!.trim(),
    dbUrl,
  };
}

// ── Migrations ─────────────────────────────────────────────────────────────

export const bootLocalRunner: MigrationRunner = (root, dbUrl) => {
  const psql = spawnSync('psql', ['--version'], { stdio: 'ignore' });
  if (psql.error || psql.status !== 0) {
    throw new InitError(
      'psql was not found. Install the PostgreSQL client (brew install libpq, apt install postgresql-client) or rerun with --skip-migrations.',
    );
  }
  // The database URL travels through the environment only; boot-local.sh never echoes it.
  const run = spawnSync('bash', [paths(root).bootScript], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'inherit',
  });
  return run.status === 0;
};

// ── Init ───────────────────────────────────────────────────────────────────

export function runInit(options: InitOptions): InitResult {
  const log = options.log ?? (() => undefined);
  const root = resolve(options.root);
  const p = paths(root);
  const files: string[] = [];
  const generated: string[] = [];
  const kept: string[] = [];

  const existingDocker = readText(p.dockerEnv);
  const existingPlatform = readText(p.platformEnv);
  const existingApi = readText(p.apiEnv);
  const sources = [existingDocker, existingPlatform, existingApi]
    .filter((t): t is string => t !== null)
    .map(parseEnv);

  const secrets: Record<string, string> = {};
  for (const key of CELUNE_SECRET_KEYS) {
    secrets[key] = pickOrGenerate(key, sources, generated);
  }

  let supabaseUrl: string;
  let anonKey: string;
  let serviceRoleKey: string;
  let siteUrl: string;

  if (options.mode === 'docker') {
    const template = readText(p.dockerTemplate);
    if (template === null) throw new InitError(`Missing ${p.dockerTemplate}`);
    const current = parseEnv(existingDocker ?? '');

    const jwtIsNew = isUnset(current.get('JWT_SECRET'));
    const jwtSecret = jwtIsNew ? randomHex(32) : current.get('JWT_SECRET')!;
    if (jwtIsNew) generated.push('JWT_SECRET');
    const apiKeyFor = (key: 'ANON_KEY' | 'SERVICE_ROLE_KEY', role: 'anon' | 'service_role') => {
      if (!jwtIsNew && !isUnset(current.get(key))) return current.get(key)!;
      generated.push(key);
      return supabaseApiKey(role, jwtSecret);
    };
    anonKey = apiKeyFor('ANON_KEY', 'anon');
    serviceRoleKey = apiKeyFor('SERVICE_ROLE_KEY', 'service_role');
    const postgresPassword = pickOrGenerate('POSTGRES_PASSWORD', [current], generated);
    const secretKeyBase = pickOrGenerate('SECRET_KEY_BASE', [current], generated, () =>
      randomBytes(48).toString('base64'),
    );
    // Realtime needs exactly 16 characters.
    const realtimeEncKey = pickOrGenerate('REALTIME_DB_ENC_KEY', [current], generated, () =>
      randomHex(8),
    );

    siteUrl = options.siteUrl ?? current.get('SITE_URL') ?? 'http://localhost:3000';
    supabaseUrl = current.get('SUPABASE_PUBLIC_URL') || 'http://localhost:8000';

    const updates: EnvUpdate[] = [
      { key: 'POSTGRES_PASSWORD', value: postgresPassword, overwrite: false },
      { key: 'JWT_SECRET', value: jwtSecret, overwrite: jwtIsNew },
      // A new JWT secret invalidates old API keys, so they are re-signed with it.
      { key: 'ANON_KEY', value: anonKey, overwrite: jwtIsNew },
      { key: 'SERVICE_ROLE_KEY', value: serviceRoleKey, overwrite: jwtIsNew },
      { key: 'SECRET_KEY_BASE', value: secretKeyBase, overwrite: false },
      { key: 'REALTIME_DB_ENC_KEY', value: realtimeEncKey, overwrite: false },
      ...CELUNE_SECRET_KEYS.map((key) => ({ key, value: secrets[key]!, overwrite: false })),
    ];
    if (options.siteUrl) updates.push({ key: 'SITE_URL', value: siteUrl, overwrite: true });

    const merged = mergeEnv(existingDocker ?? template, updates);
    kept.push(...merged.kept.map((k) => `docker/.env:${k}`));
    writeSecretFile(p.dockerEnv, merged.text);
    files.push(p.dockerEnv);
  } else {
    const link = validateSupabaseLink(options.supabase ?? {});
    supabaseUrl = link.url;
    anonKey = link.anonKey;
    serviceRoleKey = link.serviceRoleKey;
    siteUrl = options.siteUrl ?? 'http://localhost:3002';
  }

  const platformUpdates: EnvUpdate[] = [
    { key: 'NEXT_PUBLIC_SUPABASE_URL', value: supabaseUrl, overwrite: true },
    { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: anonKey, overwrite: true },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', value: serviceRoleKey, overwrite: true },
    { key: 'NEXT_PUBLIC_APP_URL', value: siteUrl, overwrite: Boolean(options.siteUrl) },
    { key: 'CELUNE_EDITION', value: 'community', overwrite: true },
    { key: 'NEXT_PUBLIC_AUTH_PROVIDERS', value: 'email', overwrite: false },
    ...CELUNE_SECRET_KEYS.map((key) => ({ key, value: secrets[key]!, overwrite: false })),
  ];
  const platform = mergeEnv(
    existingPlatform ??
      '# Written by celune init. Optional integrations are listed in .env.example.\n',
    platformUpdates,
  );
  kept.push(...platform.kept.map((k) => `apps/platform/.env.local:${k}`));
  writeSecretFile(p.platformEnv, platform.text);
  files.push(p.platformEnv);

  const apiUpdates: EnvUpdate[] = [
    { key: 'SUPABASE_URL', value: supabaseUrl, overwrite: true },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', value: serviceRoleKey, overwrite: true },
    { key: 'PORT', value: '3010', overwrite: false },
    { key: 'CELUNE_EDITION', value: 'community', overwrite: true },
    ...API_SECRET_KEYS.map((key) => ({ key, value: secrets[key]!, overwrite: false })),
  ];
  const api = mergeEnv(existingApi ?? '# Written by celune init.\n', apiUpdates);
  kept.push(...api.kept.map((k) => `apps/api/.env:${k}`));
  writeSecretFile(p.apiEnv, api.text);
  files.push(p.apiEnv);

  for (const file of files) log(`wrote ${file}`);
  if (generated.length > 0) log(`generated ${generated.join(', ')} (values written to files only)`);
  if (kept.length > 0) log(`kept ${kept.length} values that were already set`);

  let migrated = false;
  if (options.mode === 'supabase' && !options.skipMigrations) {
    log(
      'applying the schema with packages/db/scripts/boot-local.sh (baseline on an empty database, new migrations otherwise)',
    );
    const runner = options.runMigrations ?? bootLocalRunner;
    if (!runner(root, options.supabase!.dbUrl.trim())) {
      throw new InitError(`Migrations failed. Fix the error above and rerun ${cliCommand()} init.`);
    }
    migrated = true;
  }

  return { files, generated, kept, migrated };
}

export function nextSteps(mode: InitMode, migrated: boolean): string[] {
  if (mode === 'docker') {
    return [
      'docker compose -f docker/docker-compose.yml up -d --build',
      'create the first account (sign-up is off by default): see "First account" in SETUP.md',
      'open http://localhost:3000, sign in, and create your workspace',
      'API health: http://localhost:3010/health (REST at /v1, MCP at /v1/mcp)',
    ];
  }
  return [
    ...(migrated ? [] : ['apply migrations: DATABASE_URL=... packages/db/scripts/boot-local.sh']),
    'pnpm dev                 # web app at http://localhost:3002',
    'pnpm --filter api dev    # API at http://localhost:3010',
    'sign up, create a workspace, then add a provider key in Settings > Provider Keys',
  ];
}
