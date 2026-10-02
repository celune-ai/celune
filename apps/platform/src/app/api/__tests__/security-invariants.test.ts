/**
 * Security Invariants Test Suite
 *
 * Static analysis tests that verify all API routes include required security
 * protections. New routes automatically fail if missing security measures.
 *
 * This file does NOT test runtime behavior — it verifies that security patterns
 * are present in source code. Runtime tests live in individual route test files.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const API_DIR = join(__dirname, '..');

/** Recursively find all route.ts files under the API directory. */
function findRouteFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === '__tests__' || entry === 'node_modules') continue;
    if (statSync(full).isDirectory()) {
      files.push(...findRouteFiles(full));
    } else if (entry === 'route.ts') {
      files.push(full);
    }
  }
  return files;
}

/** Extract exported HTTP method names from route file content. */
function getHttpMethods(content: string): string[] {
  const methods: string[] = [];
  // Match: export async function GET/POST/PUT/PATCH/DELETE
  // Also match: export const POST = withApiSecurity(...)
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    if (
      content.includes(`export async function ${m}`) ||
      content.includes(`export function ${m}`) ||
      content.includes(`export const ${m}`)
    ) {
      methods.push(m);
    }
  }
  return methods;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Routes that are exempt from certain security checks. */
const CSRF_EXEMPT_ROUTES = new Set([
  // Webhook routes — use signature verification instead of CSRF
  'billing/webhook',
  'github/webhooks',
  'webhooks/agentmail',
  'slack/commands',
  'slack/celune',
  'slack/events',
  'slack/interactions',
  // GitHub — uses HMAC-SHA256 webhook signature verification
  'github/webhooks',
  // Discord — uses Ed25519 signature verification or shared secret
  'discord/interactions',
  'discord/gateway-events',
  'discord/register-commands',
  'discord/channels',
  // Sentry webhooks — use HMAC signature verification
  'webhooks/sentry',
  'webhooks/sentry/heartbeat',
  // Cron routes — use CRON_SECRET auth
  'cron/run',
  'cron/weekly-digest',
  'cron/activity-digest',
  'health/check-and-alert',
  'webhooks/retry',
  'memory/ingest',
  // Internal-only routes
  'hooks/notify',
  'notifications/dispatch',
  // Public CORS-enabled routes — use per-workspace origin allowlisting
  'portfolio/verify',
  // Public support chat — CORS-enabled, serves web/docs/app widget
  'chat/support',
  // CLI auth — rate-limited, no browser origin
  'auth/cli-token',
  // CLI setup code exchange — called from CLI, not browser
  'auth/cli-exchange',
  // Device auth — called from CLI polling, not browser
  'auth/device/code',
  'auth/device/token',
  'auth/device/verify',
  // MCP uses API key auth, not browser cookies — CSRF not applicable
  'mcp',
  // @celuneai/api surface — bearer API keys and host JWTs only, no session cookie
  'v1/[[...route]]',
  // Public access code validation — rate-limited, no session cookie
  'access-codes/validate',
  // Device auth flow — CLI-initiated, no browser origin
  'auth/device/code',
  'auth/device/token',
  'auth/device/verify',
  // Slack — cron-triggered digest, uses CRON_SECRET
  'slack/digest',
]);

const RATE_LIMIT_EXEMPT_ROUTES = new Set([
  // Same webhook/cron routes don't need rate limiting
  'billing/webhook',
  'github/webhooks',
  'webhooks/agentmail',
  'slack/commands',
  'slack/celune',
  'slack/events',
  'slack/interactions',
  // Discord — Ed25519 signature verification, own rate limiting
  'discord/interactions',
  'discord/gateway-events',
  'discord/register-commands',
  'discord/channels',
  // Slack — cron-triggered digest
  'slack/digest',
  'webhooks/sentry',
  'webhooks/sentry/heartbeat',
  'cron/run',
  'cron/weekly-digest',
  'cron/activity-digest',
  'health/check-and-alert',
  'webhooks/retry',
  'memory/ingest',
  'hooks/notify',
  'notifications/dispatch',
  // Deprecated/stub endpoints
  'brain/tier-change',
]);

const AUTH_EXEMPT_ROUTES = new Set([
  // Public endpoints
  'health',
  'health/check-and-alert',
  'billing/webhook',
  'github/webhooks',
  'github/callback',
  'webhooks/agentmail',
  'slack/commands',
  'slack/celune',
  'slack/events',
  'cron/run',
  'cron/weekly-digest',
  'cron/activity-digest',
  'webhooks/retry',
  'hooks/notify',
  'notifications/dispatch',
  // GitHub — HMAC-SHA256 webhook signature verification
  'github/webhooks',
  // Discord — Ed25519 / shared secret / service key / OAuth callback
  'discord/interactions',
  'discord/gateway-events',
  'discord/install',
  'discord/oauth/callback',
  'discord/register-commands',
  // Slack — cron-triggered digest
  'slack/digest',
  'waitlist',
  'brain/tier-change',
  'portfolio/verify',
  'support/feedback',
  'support/contact',
  'auth/signout',
  'auth/cli-token',
  'analytics/vercel',
  'access-codes/redeem',
  'invitations/accept',
  // Internal utility routes (no user data)
  'health/mcps',
  'analytics/cost/credits',
  'analytics/cost/elevenlabs',
  'billing/plans',
  // Public endpoints for gated signup flow
  'flags/public',
  'access-codes/validate',
]);

const routeFiles = findRouteFiles(API_DIR);

describe('Security Invariants', () => {
  it('discovers API route files', () => {
    expect(routeFiles.length).toBeGreaterThan(50);
  });

  describe('CSRF validation on write routes', () => {
    for (const file of routeFiles) {
      const routePath = relative(API_DIR, file).replace('/route.ts', '');
      const content = readFileSync(file, 'utf8');
      const methods = getHttpMethods(content);
      const hasWriteMethod = methods.some((m) => WRITE_METHODS.has(m));

      if (!hasWriteMethod || CSRF_EXEMPT_ROUTES.has(routePath)) continue;

      it(`${routePath} has CSRF validation`, () => {
        const hasCsrf = content.includes('validateOrigin') || content.includes('withApiSecurity');
        expect(hasCsrf).toBe(true);
      });
    }
  });

  describe('Rate limiting on write routes', () => {
    for (const file of routeFiles) {
      const routePath = relative(API_DIR, file).replace('/route.ts', '');
      const content = readFileSync(file, 'utf8');
      const methods = getHttpMethods(content);
      const hasWriteMethod = methods.some((m) => WRITE_METHODS.has(m));

      if (!hasWriteMethod || RATE_LIMIT_EXEMPT_ROUTES.has(routePath)) continue;

      it(`${routePath} has rate limiting`, () => {
        const hasRateLimit =
          content.includes('applyRateLimit') || content.includes('withApiSecurity');
        expect(hasRateLimit).toBe(true);
      });
    }
  });

  describe('Authentication on all routes', () => {
    for (const file of routeFiles) {
      const routePath = relative(API_DIR, file).replace('/route.ts', '');
      const content = readFileSync(file, 'utf8');

      if (AUTH_EXEMPT_ROUTES.has(routePath)) continue;

      it(`${routePath} has authentication`, () => {
        const hasAuth =
          content.includes('getAuthUserId') ||
          content.includes('requirePermission') ||
          content.includes('requirePlatformOwner') ||
          content.includes('requireUserScope') ||
          content.includes('withApiSecurity') ||
          content.includes('requireWorkspaceMembership') ||
          content.includes('authenticateApiKey') ||
          content.includes('auth.getUser') ||
          content.includes('extractWorkspaceScope') ||
          content.includes('requireWorkspaceScope') ||
          content.includes('extractRequiredWorkspaceId') ||
          content.includes('createClient') || // Supabase session-based auth
          content.includes('createServiceClient') || // Service-level routes
          content.includes('getPlatformApi') || // @celuneai/api authenticates in its middleware
          content.includes('authorizeWorkspaceTransfer') || // session or API key, via authorizeBrainTransfer
          content.includes('CRON_SECRET');
        expect(hasAuth).toBe(true);
      });
    }
  });

  describe('No raw error.message leaks', () => {
    for (const file of routeFiles) {
      const routePath = relative(API_DIR, file).replace('/route.ts', '');
      const content = readFileSync(file, 'utf8');

      it(`${routePath} does not leak error.message`, () => {
        // Match patterns that expose raw error messages to clients:
        // - { error: error.message }
        // - { error: err.message }
        // - { error: e.message }
        // Allow: safeErrorResponse, console.error, stderr, comments
        const lines = content.split('\n');
        const leaks: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          // Skip comments
          if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
          // Skip console/stderr (server-side logging is fine)
          if (line.includes('console.') || line.includes('stderr')) continue;
          // Detect error.message in JSON response context
          if (
            line.includes('error.message') &&
            (line.includes('NextResponse.json') ||
              line.includes('json(') ||
              line.includes('error:'))
          ) {
            // Allow safeErrorResponse usage
            if (!line.includes('safeErrorResponse')) {
              leaks.push(`Line ${i + 1}: ${line}`);
            }
          }
        }
        expect(leaks).toEqual([]);
      });
    }
  });

  describe('Zod validation on POST/PUT/PATCH bodies', () => {
    for (const file of routeFiles) {
      const routePath = relative(API_DIR, file).replace('/route.ts', '');
      const content = readFileSync(file, 'utf8');
      const methods = getHttpMethods(content);
      const hasBodyMethod = methods.some((m) => ['POST', 'PUT', 'PATCH'].includes(m));

      if (!hasBodyMethod) continue;
      // Skip routes that don't parse JSON bodies (file uploads, streaming, webhooks)
      if (!content.includes('request.json()')) continue;

      it(`${routePath} has Zod body validation`, () => {
        const hasZod =
          content.includes('safeParse') ||
          content.includes('parseBody') ||
          content.includes('withApiSecurity') ||
          content.includes('.parse(');
        expect(hasZod).toBe(true);
      });
    }
  });
});
