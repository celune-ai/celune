/**
 * GitHub App integration service.
 *
 * Provides JWT-based authentication, installation token management,
 * and repository access for workspace-repository linking.
 *
 * Required environment variables:
 *   GITHUB_APP_ID              — numeric App ID
 *   GITHUB_APP_CLIENT_ID       — OAuth client ID
 *   GITHUB_APP_CLIENT_SECRET   — OAuth client secret
 *   GITHUB_APP_PRIVATE_KEY     — PEM-encoded private key (for JWT signing)
 *   GITHUB_APP_INSTALL_URL     — https://github.com/apps/<slug>/installations/new
 *   GITHUB_APP_WEBHOOK_SECRET  — webhook signature verification (optional for now)
 */

import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { createServiceClient } from '@repo/db/service';
import { encryptProviderKey, decryptProviderKey } from './provider-key-crypto';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GitHubAppNotConfiguredError extends Error {
  constructor(missing?: string[]) {
    super(
      missing
        ? `GitHub App missing env vars: ${missing.join(', ')}`
        : 'GitHub App is not configured.',
    );
    this.name = 'GitHubAppNotConfiguredError';
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  'GITHUB_APP_ID',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
] as const;

function assertConfigured() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) throw new GitHubAppNotConfiguredError([...missing]);
}

/**
 * Normalize a PEM private key that may be stored as a single line in an env var.
 *
 * GitHub provides PKCS#1 keys (`BEGIN RSA PRIVATE KEY`). When stored in .env
 * files the newlines are often stripped, producing a single-line blob. OpenSSL 3.x
 * (used by Node.js v18+) requires proper PEM formatting with 64-char base64 lines.
 *
 * This function:
 *   1. Replaces literal `\n` escape sequences with real newlines
 *   2. Re-wraps the base64 body into 64-character lines (PEM standard)
 */
function normalizePrivateKey(raw: string): string {
  // Replace literal \n strings (common in .env files / Vercel)
  let key = raw.replace(/\\n/g, '\n').trim();

  // If the key is already multi-line with proper formatting, return as-is
  const lines = key.split('\n');
  if (lines.length > 3) return key;

  // Single-line key — extract header, base64, footer and re-wrap
  const match = key.match(/^(-----BEGIN [A-Z ]+-----)([A-Za-z0-9+/=\s]+)(-----END [A-Z ]+-----)$/);
  if (!match) return key; // Can't parse — return unchanged

  const header = match[1];
  const base64 = match[2].replace(/\s/g, '');
  const footer = match[3];

  // Wrap base64 at 64 characters per line (PEM standard)
  const wrapped = base64.match(/.{1,64}/g)?.join('\n') ?? base64;
  return `${header}\n${wrapped}\n${footer}\n`;
}

/** Cached normalized key (computed once per process). */
let _normalizedKey: string | null = null;

function getPrivateKey(): string {
  if (!_normalizedKey) {
    _normalizedKey = normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY ?? '');
  }
  return _normalizedKey;
}

/** Check if the GitHub App is configured without throwing. */
export function isGitHubAppConfigured(): boolean {
  return REQUIRED_ENV.every((k) => !!process.env[k]);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  private: boolean;
  default_branch: string;
  description: string | null;
}

export interface GitHubInstallationResult {
  installation_id: number;
  account_login: string;
  account_type: 'User' | 'Organization';
  repos: GitHubRepo[];
}

// ---------------------------------------------------------------------------
// Token cache: in-memory + DB-backed with AES-256-GCM encryption at rest.
// Tokens are valid for 1 hour; we cache with a 5-min buffer.
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<number, CachedToken>();
const TOKEN_BUFFER_MS = 10 * 60 * 1000; // refresh 10 min before expiry (safety margin)
const TOKEN_CACHE_MAX_SIZE = 100; // LRU eviction cap

// Per-installation mutex to prevent concurrent token refresh races
const tokenLocks = new Map<number, Promise<string>>();

/** Evict expired entries, then oldest if over cap. */
function evictTokenCache(): void {
  const now = Date.now();
  // First pass: remove expired entries
  for (const [key, val] of tokenCache) {
    if (val.expiresAt <= now) tokenCache.delete(key);
  }
  // Second pass: if still over cap, remove oldest by expiry
  if (tokenCache.size > TOKEN_CACHE_MAX_SIZE) {
    const sorted = [...tokenCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toRemove = sorted.slice(0, tokenCache.size - TOKEN_CACHE_MAX_SIZE);
    for (const [key] of toRemove) tokenCache.delete(key);
  }
}

/**
 * Read a cached token from the DB (encrypted at rest).
 * Returns null if no valid token exists or decryption fails.
 */
async function readTokenFromDB(installationId: number): Promise<CachedToken | null> {
  try {
    // Service client: reads encrypted token cache. Accesses: workspace_github_tokens.
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('workspace_github_tokens')
      .select('encrypted_token, token_iv, token, expires_at')
      .eq('installation_id', installationId)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;

    let plaintext: string;

    // Prefer encrypted token; fall back to plaintext for pre-migration rows
    if (data.encrypted_token && data.token_iv) {
      try {
        plaintext = decryptProviderKey(data.encrypted_token, data.token_iv);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `GitHub token decryption failed for installation ${installationId} (key rotated?):`,
          message,
        );
        return null;
      }
    } else if (data.token) {
      plaintext = data.token;
    } else {
      return null;
    }

    return {
      token: plaintext,
      expiresAt: new Date(data.expires_at).getTime(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `GitHub token DB read failed for installation ${installationId}, degrading to API-only:`,
      message,
    );
    return null;
  }
}

/**
 * Write a token to the DB encrypted at rest.
 * Uses upsert on installation_id (via the unique workspace index).
 */
async function writeTokenToDB(
  installationId: number,
  token: string,
  expiresAt: Date,
): Promise<void> {
  try {
    const { encryptedKey, iv } = encryptProviderKey(token);

    // Service client: writes encrypted token cache. Accesses: workspace_github_tokens.
    const supabase = createServiceClient();

    // Find the workspace linked to this installation
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('github_installation_id', installationId)
      .limit(1)
      .maybeSingle();

    if (!workspace) return; // No workspace linked — skip DB caching

    // Upsert: the table has a unique index on workspace_id
    await supabase.from('workspace_github_tokens').upsert(
      {
        workspace_id: workspace.id,
        installation_id: installationId,
        encrypted_token: encryptedKey,
        token_iv: iv,
        token: null, // never store plaintext
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'workspace_id' },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `GitHub token DB write failed for installation ${installationId} (in-memory cache still valid):`,
      message,
    );
  }
}

// ---------------------------------------------------------------------------
// Octokit factory
// ---------------------------------------------------------------------------

/**
 * Create an Octokit instance authenticated as the GitHub App itself (JWT).
 * Use this for app-level endpoints (list installations, etc.).
 */
export function createAppOctokit(): Octokit {
  assertConfigured();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID!,
      privateKey: getPrivateKey(),
      clientId: process.env.GITHUB_APP_CLIENT_ID!,
      clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
    },
  });
}

/**
 * Get an installation access token (cached, auto-refreshes).
 *
 * Cache layers (checked in order):
 *   1. In-memory Map (fastest, per-process)
 *   2. DB table workspace_github_tokens (encrypted at rest, shared across instances)
 *   3. GitHub API (issues a new token, writes back to both caches)
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  assertConfigured();

  // 1. Check in-memory cache (no lock needed for reads)
  const memCached = tokenCache.get(installationId);
  if (memCached && memCached.expiresAt > Date.now() + TOKEN_BUFFER_MS) {
    return memCached.token;
  }

  // 2. Use per-installation lock to prevent concurrent refresh races
  const existingLock = tokenLocks.get(installationId);
  if (existingLock) {
    return existingLock;
  }

  const refreshPromise = refreshInstallationToken(installationId);
  tokenLocks.set(installationId, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    tokenLocks.delete(installationId);
  }
}

/** Internal: fetch token from DB or GitHub (called under lock). */
async function refreshInstallationToken(installationId: number): Promise<string> {
  // Check DB cache (encrypted at rest)
  const dbCached = await readTokenFromDB(installationId);
  if (dbCached && dbCached.expiresAt > Date.now() + TOKEN_BUFFER_MS) {
    // Promote to in-memory cache
    tokenCache.set(installationId, dbCached);
    return dbCached.token;
  }

  // Fetch fresh token from GitHub
  try {
    const auth = createAppAuth({
      appId: process.env.GITHUB_APP_ID!,
      privateKey: getPrivateKey(),
      clientId: process.env.GITHUB_APP_CLIENT_ID!,
      clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
      installationId,
    });

    const result = await auth({ type: 'installation' });
    const expiresAt = new Date(result.expiresAt).getTime();

    // Write to both caches
    tokenCache.set(installationId, {
      token: result.token,
      expiresAt,
    });
    evictTokenCache();

    // Fire-and-forget DB write (don't block the caller)
    writeTokenToDB(installationId, result.token, new Date(result.expiresAt)).catch((err) => {
      console.warn('[github-app] Failed to write token to DB cache:', err?.message ?? err);
    });

    return result.token;
  } catch (err) {
    // On fetch failure, clear stale cache entries to force fresh fetch next time
    tokenCache.delete(installationId);
    throw err;
  }
}

/**
 * Create an Octokit instance authenticated as a specific installation.
 * Use this for all repo-scoped operations (list repos, create branches, PRs, etc.).
 */
export async function createInstallationOctokit(installationId: number): Promise<Octokit> {
  const token = await getInstallationToken(installationId);
  return new Octokit({ auth: token });
}

// ---------------------------------------------------------------------------
// Install URL & OAuth state (delegated to oauth-state.ts)
// ---------------------------------------------------------------------------

export { generateGitHubOAuthState, parseGitHubOAuthState } from './oauth-state';

/**
 * Returns the URL to redirect users to for GitHub App installation.
 * State param correlates the callback with the workspace.
 */
export function getGitHubAppInstallUrl(state: string): string {
  assertConfigured();
  const base = process.env.GITHUB_APP_INSTALL_URL;
  if (!base) throw new GitHubAppNotConfiguredError(['GITHUB_APP_INSTALL_URL']);
  const url = new URL(base);
  url.searchParams.set('state', state);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Repository operations
// ---------------------------------------------------------------------------

/**
 * List all repositories accessible under a GitHub App installation.
 */
export async function listInstallationRepos(installationId: number): Promise<GitHubRepo[]> {
  const octokit = await createInstallationOctokit(installationId);

  const repos: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await octokit.apps.listReposAccessibleToInstallation({
      per_page: perPage,
      page,
    });

    for (const repo of data.repositories) {
      repos.push({
        id: repo.id,
        full_name: repo.full_name,
        html_url: repo.html_url,
        private: repo.private,
        default_branch: repo.default_branch,
        description: repo.description ?? null,
      });
    }

    if (repos.length >= data.total_count || data.repositories.length < perPage) break;
    page++;
  }

  return repos;
}

/**
 * Verify a specific repo is accessible under an installation.
 */
export async function verifyRepoAccess(
  installationId: number,
  repoFullName: string,
): Promise<GitHubRepo> {
  const repos = await listInstallationRepos(installationId);
  const repo = repos.find((r) => r.full_name === repoFullName);
  if (!repo) {
    throw new Error(
      `Repository "${repoFullName}" is not accessible under installation ${installationId}.`,
    );
  }
  return repo;
}

/**
 * Create a new repository under the installation's account.
 */
export async function createRepository(
  installationId: number,
  options: {
    name: string;
    description?: string;
    private?: boolean;
    org?: string;
    autoInit?: boolean;
  },
): Promise<GitHubRepo> {
  const octokit = await createInstallationOctokit(installationId);

  const createFn = options.org
    ? () =>
        octokit.repos.createInOrg({
          org: options.org!,
          name: options.name,
          description: options.description,
          private: options.private ?? true,
          auto_init: options.autoInit ?? true,
        })
    : () =>
        octokit.repos.createForAuthenticatedUser({
          name: options.name,
          description: options.description,
          private: options.private ?? true,
          auto_init: options.autoInit ?? true,
        });

  const { data: repo } = await createFn();

  return {
    id: repo.id,
    full_name: repo.full_name,
    html_url: repo.html_url,
    private: repo.private,
    default_branch: repo.default_branch,
    description: repo.description ?? null,
  };
}
