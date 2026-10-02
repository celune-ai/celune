import { type NextRequest, NextResponse } from 'next/server';
import { updateSession, getSessionUserId } from '@repo/db/middleware';
import { createServiceClient } from '@repo/db/service';
import { validateOrigin } from '@/lib/csrf';
import { resolvePermissions } from '@/lib/permissions';
import type { PermissionKey } from '@repo/types';
import { resolveHostConfig } from '@celuneai/core/config';

// Edge runtime: read the prefix from config directly instead of the node-only key helpers
const API_KEY_BEARER_PREFIX = `${resolveHostConfig({ CELUNE_API_KEY_PREFIX: process.env.CELUNE_API_KEY_PREFIX }).apiKeyPrefix}_`;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ── Global API rate limiting (in-memory, per-instance) ─────────────────────
// Baseline protection for all authenticated API routes. Per-route limits in
// withApiSecurity/applyRateLimit provide stricter control for sensitive routes.
const GLOBAL_RATE_LIMIT = { read: 300, write: 120, windowMs: 60_000 };
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
let lastRateLimitCleanup = Date.now();
let isCleaningRateLimit = false;

// ── Permission cache (in-memory, per-instance) ──────────────────────────────
// Caches resolvePermissions() results to avoid 2-6 DB queries per request.
// Keyed by userId:workspaceId, TTL 60s. Safe because permission changes are
// rare and cache resets on deploy.
const PERMISSION_CACHE_TTL_MS = 60_000;
type CachedPermissions = {
  permissions: Set<string>;
  role: { slug: string } | null;
  isOwner: boolean;
  isPlatformOwner: boolean;
  cachedAt: number;
};
const permissionCache = new Map<string, CachedPermissions>();
let lastPermissionCacheCleanup = Date.now();
let isCleaningPermissions = false;

async function getCachedPermissions(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
  workspaceId: string,
): Promise<CachedPermissions> {
  const now = Date.now();
  // Periodic eviction of stale entries (every 60s), guarded to prevent concurrent iteration
  if (now - lastPermissionCacheCleanup > PERMISSION_CACHE_TTL_MS && !isCleaningPermissions) {
    isCleaningPermissions = true;
    for (const [key, entry] of permissionCache) {
      if (now - entry.cachedAt >= PERMISSION_CACHE_TTL_MS) permissionCache.delete(key);
    }
    lastPermissionCacheCleanup = now;
    isCleaningPermissions = false;
  }

  const cacheKey = `${userId}:${workspaceId}`;
  const cached = permissionCache.get(cacheKey);
  if (cached && now - cached.cachedAt < PERMISSION_CACHE_TTL_MS) {
    return cached;
  }

  const resolved = await resolvePermissions(serviceClient, userId, workspaceId);
  const entry: CachedPermissions = {
    permissions: resolved.permissions,
    role: resolved.role,
    isOwner: resolved.isOwner,
    isPlatformOwner: resolved.isPlatformOwner,
    cachedAt: now,
  };
  permissionCache.set(cacheKey, entry);
  return entry;
}

function checkGlobalRateLimit(
  userId: string,
  method: string,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  // Cleanup every 60s, guarded to prevent concurrent iteration
  if (now - lastRateLimitCleanup > 60_000 && !isCleaningRateLimit) {
    isCleaningRateLimit = true;
    for (const [key, entry] of rateLimitStore) {
      if (now - entry.windowStart >= GLOBAL_RATE_LIMIT.windowMs) rateLimitStore.delete(key);
    }
    lastRateLimitCleanup = now;
    isCleaningRateLimit = false;
  }

  const isWrite = MUTATING_METHODS.has(method);
  const limit = isWrite ? GLOBAL_RATE_LIMIT.write : GLOBAL_RATE_LIMIT.read;
  const key = `${userId}:${isWrite ? 'w' : 'r'}`;
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart >= GLOBAL_RATE_LIMIT.windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1 };
  }

  entry.count += 1;
  if (entry.count > limit) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: limit - entry.count };
}

/**
 * Page routes that require specific permissions.
 * Routes not listed here are accessible to all authenticated users.
 * Matching is prefix-based (startsWith), so '/agents' covers '/agents/settings' etc.
 */
const ROUTE_PERMISSIONS: Record<string, PermissionKey[]> = {
  '/memory': ['settings:manage'],
  '/apps': ['settings:manage'],
  '/agents': ['agents:read'],
  '/feed': ['analytics:read'],
  '/alerts': ['analytics:read'],
  '/analytics': ['analytics:read'],
  '/settings': ['settings:read'],
  '/workspace-settings': ['settings:read'],
};

/**
 * API route permission restrictions.
 * `permissions` = required for mutating methods (POST/PUT/PATCH/DELETE).
 * `readPermissions` = required for GET/HEAD only.
 * Routes not listed are accessible to all authenticated users.
 * Matching is prefix-based (startsWith).
 */
const API_ROUTE_PERMISSIONS: Record<
  string,
  { permissions: PermissionKey[]; readPermissions?: PermissionKey[] }
> = {
  // Owner-only
  '/api/memory/': { permissions: ['settings:manage'] },
  '/api/billing/': { permissions: ['billing:manage'] },
  // Admin+
  '/api/agents/': { permissions: ['agents:configure'], readPermissions: ['agents:read'] },
  '/api/activity': { permissions: ['analytics:read'] },
  '/api/analytics/': { permissions: ['analytics:read'] },
  '/api/alerts/': { permissions: ['analytics:read'] },
  '/api/users': { permissions: ['users:manage'], readPermissions: ['users:read'] },
  '/api/invitations': { permissions: ['users:invite'] },
  '/api/api-keys': { permissions: ['api_keys:manage'], readPermissions: ['api_keys:read'] },
  '/api/audit-log': { permissions: ['audit_log:read'] },
  '/api/webhooks/': { permissions: ['webhooks:manage'], readPermissions: ['webhooks:read'] },
  // Member+ write, viewer read-only
  '/api/tasks': { permissions: ['tasks:create'], readPermissions: ['tasks:read'] },
  '/api/projects': { permissions: ['projects:create'], readPermissions: ['projects:read'] },
  '/api/project-groups': { permissions: ['projects:create'], readPermissions: ['projects:read'] },
  // Routes that enforce auth per-handler but benefit from middleware permission gating
  '/api/brain/': { permissions: ['settings:manage'], readPermissions: ['settings:read'] },
  '/api/agentmail/': { permissions: ['agents:configure'], readPermissions: ['agents:read'] },
  '/api/onboarding/': { permissions: ['settings:manage'], readPermissions: ['settings:read'] },
  '/api/org/': { permissions: ['settings:manage'], readPermissions: ['settings:read'] },
};

// API routes that do not require an authenticated session
const PUBLIC_API_PREFIXES = [
  '/api/auth/',
  '/api/billing/webhook',
  '/api/github/webhooks',
  '/api/github/callback',
  '/api/slack/commands',
  '/api/slack/events',
  '/api/slack/interactions',
  '/api/discord/interactions',
  '/api/hooks/notify',
  '/api/support/contact',
  '/api/webhooks/sentry',
  // Health check — must be unauthenticated for Railway / load-balancer probes
  '/api/health',
  // Gated signup — public endpoints for access code validation + flag checks
  '/api/access-codes/validate',
  '/api/flags/public',
  // @celuneai/api surface — authenticates API keys and host JWTs in the handler
  '/api/v1/',
  '/api/mcp',
];

// API routes that accept API key authentication (Bearer <prefix>_xxx)
const API_KEY_PREFIXES = [
  '/api/tasks',
  '/api/projects',
  '/api/agents/',
  '/api/analytics/',
  '/api/mcp',
];

function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

const AUTH_PAGES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/check-email',
  '/auth/callback',
  '/waitlist',
];

/** Page routes accessible without authentication */
const PUBLIC_PAGES = ['/docs', '/device'];

/**
 * Strip the workspace slug (first path segment) from page routes.
 * E.g. /main/analytics → /analytics, /celune-web/tasks/123 → /tasks/123
 * Auth pages and root (/) are returned as-is.
 */
function stripWorkspaceSlug(pathname: string): string {
  // Auth pages, root — no slug to strip
  if (pathname === '/' || AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return pathname;
  }
  // /slug or /slug/rest → /rest (or /)
  const slashIdx = pathname.indexOf('/', 1);
  if (slashIdx === -1) return '/';
  return pathname.slice(slashIdx);
}

/** Writes usually name their workspace in a JSON body, so the gate checks it there too. */
async function jsonBodyWorkspaceId(request: NextRequest): Promise<string | null> {
  if (!MUTATING_METHODS.has(request.method)) return null;
  if (!request.headers.get('content-type')?.includes('application/json')) return null;
  try {
    const body: unknown = await request.clone().json();
    const id = (body as { workspace_id?: unknown } | null)?.workspace_id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export default async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Supabase email confirmation: when a verification link redirects here with a
  // `code` param, forward it to /auth/callback so the code gets exchanged for a
  // session before any other routing logic runs.
  // Only intercept Supabase PKCE auth codes (UUID-shaped). Access codes are
  // short alphanumeric strings and should reach /signup directly.
  const code = searchParams.get('code');
  const isSupabaseAuthCode =
    code && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);
  if (
    isSupabaseAuthCode &&
    pathname !== '/auth/callback' &&
    pathname !== '/signup' &&
    !pathname.startsWith('/api/')
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    url.searchParams.set('code', code);
    // Preserve the intended destination so callback can redirect after login
    const next = pathname === '/' ? '/' : pathname;
    url.searchParams.set('next', next);
    return NextResponse.redirect(url);
  }

  // OAuth discovery probes from MCP clients (e.g. Claude Code checks .well-known
  // before connecting). We use Bearer token auth, not OAuth — return JSON 404 so
  // the client falls back to the provided token without hitting the login redirect.
  if (pathname.startsWith('/.well-known/')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // CSRF: reject mutating requests with invalid origin
  // Skip for endpoints that handle their own auth (no browser Origin header)
  const csrfExempt =
    pathname.startsWith('/api/billing/webhook') ||
    pathname.startsWith('/api/mcp') ||
    pathname.startsWith('/api/v1/') ||
    pathname.startsWith('/api/auth/cli-token') ||
    pathname.startsWith('/api/auth/cli-exchange') ||
    pathname.startsWith('/api/auth/device/code') ||
    pathname.startsWith('/api/auth/device/token') ||
    pathname.startsWith('/api/slack/') ||
    pathname.startsWith('/api/discord/') ||
    pathname.startsWith('/api/github/webhooks') ||
    pathname.startsWith('/api/webhooks/sentry');
  if (MUTATING_METHODS.has(request.method) && !csrfExempt) {
    const rejection = await validateOrigin(request);
    if (rejection) return rejection;
  }

  // API routes: verify session or API key, return 401 for unauthenticated requests
  if (pathname.startsWith('/api/')) {
    if (isPublicApiRoute(pathname)) {
      return NextResponse.next({ request });
    }

    // Check for API key auth (Bearer <prefix>_xxx or X-API-Key header)
    const authHeader = request.headers.get('authorization') ?? '';
    const apiKeyHeader = request.headers.get('x-api-key') ?? '';
    const apiKeyValue = authHeader.startsWith(`Bearer ${API_KEY_BEARER_PREFIX}`)
      ? authHeader.slice(7)
      : apiKeyHeader.startsWith(API_KEY_BEARER_PREFIX)
        ? apiKeyHeader
        : '';
    // Validate prefix + minimum length (key prefix + 32 chars minimum)
    const hasApiKey =
      apiKeyValue.startsWith(API_KEY_BEARER_PREFIX) &&
      apiKeyValue.length >= API_KEY_BEARER_PREFIX.length + 32;

    if (hasApiKey && API_KEY_PREFIXES.some((p) => pathname.startsWith(p))) {
      // API key auth — skip session check, let the route handler verify the key
      // Set x-api-key-auth header so route handlers know to use API key auth
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-api-key-auth', '1');
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    let userId: string | null = null;
    try {
      userId = await getSessionUserId(request);
    } catch {
      // Supabase error — fail closed
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const requestHeaders = new Headers(request.headers);
    // Strip any incoming x-user-id to prevent spoofing, then set the authenticated value
    requestHeaders.delete('x-user-id');
    requestHeaders.set('x-user-id', userId);

    // Check API route permissions
    const matchedApiRoute = Object.keys(API_ROUTE_PERMISSIONS).find((route) =>
      pathname.startsWith(route),
    );

    const workspaceId =
      request.nextUrl.searchParams.get('workspace_id') ?? (await jsonBodyWorkspaceId(request));

    // Without a workspace only the platform owner holds permissions, so the gate
    // defers to the route handler, which scopes itself to an org, a workspace it
    // loads from a row, or the platform owner.
    if (matchedApiRoute && workspaceId) {
      const { permissions: requiredPerms, readPermissions } =
        API_ROUTE_PERMISSIONS[matchedApiRoute];

      try {
        // Service client: middleware resolves permissions before user context reaches route handlers. Accesses: user_roles, org_members, workspace_memberships, role_permissions.
        const serviceClient = createServiceClient();
        const resolved = await getCachedPermissions(serviceClient, userId, workspaceId);

        const isReadMethod = !MUTATING_METHODS.has(request.method);
        const hasFullAccess = requiredPerms.every((p) => resolved.permissions.has(p));
        const hasReadAccess =
          isReadMethod && readPermissions?.every((p) => resolved.permissions.has(p));

        if (!hasFullAccess && !hasReadAccess) {
          console.warn('[middleware] Permission denied:', {
            userId,
            pathname,
            method: request.method,
            workspace_id: workspaceId,
            requiredPerms,
            readPermissions,
            resolvedPermCount: resolved.permissions.size,
            isOwner: resolved.isOwner,
            isPlatformOwner: resolved.isPlatformOwner,
          });
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Pass role slug downstream so requirePermission() can skip re-resolving
        if (resolved.role) {
          requestHeaders.set('x-user-role', resolved.role.slug);
        } else if (resolved.isOwner || resolved.isPlatformOwner) {
          requestHeaders.set('x-user-role', 'owner');
        }
      } catch (permErr) {
        // Fail closed: if we can't determine permissions, deny access
        console.error('[middleware] Permission resolution failed:', {
          userId,
          pathname,
          workspace_id: workspaceId,
          error: permErr instanceof Error ? permErr.message : String(permErr),
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Global rate limit check
    const rateResult = checkGlobalRateLimit(userId, request.method);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Public pages (e.g. /docs) — skip auth entirely
  if (PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next({ request });
  }

  const isAuthPage = AUTH_PAGES.some(
    (p) => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith('/auth/'),
  );

  let user = null;
  let response = NextResponse.next({ request });

  // Skip token refresh on auth pages — there's no valid session to refresh,
  // and attempting it burns through Supabase rate limits with stale cookies
  if (!isAuthPage) {
    try {
      const result = await updateSession(request);
      user = result.user;
      response = result.response;
    } catch {
      // Supabase error — fail closed: redirect to login rather than letting through
    }
  }

  if (!isAuthPage && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && user && request.nextUrl.pathname !== '/reset-password') {
    // Redirect to root which will redirect to the user's default workspace
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // Permission-based route check for authenticated page requests
  // Strip workspace slug so /main/analytics matches /analytics in ROUTE_PERMISSIONS
  if (user && !isAuthPage) {
    const pagePath = stripWorkspaceSlug(pathname);
    // Extract workspace slug (first segment) to preserve in redirects
    const workspaceSlug = pathname.split('/')[1] ?? 'main';
    const matchedRoute = Object.keys(ROUTE_PERMISSIONS).find((route) => pagePath.startsWith(route));

    if (matchedRoute) {
      const requiredPerms = ROUTE_PERMISSIONS[matchedRoute];

      try {
        // Service client: middleware resolves page-level permissions before rendering; no user-scoped client available. Accesses: workspaces, user_roles, org_members, workspace_memberships, role_permissions.
        const serviceClient = createServiceClient();
        // Look up workspace by slug for permission resolution
        const { data: ws } = await serviceClient
          .from('workspaces')
          .select('id')
          .eq('slug', workspaceSlug)
          .single();

        const resolved = await getCachedPermissions(serviceClient, user.id, ws?.id ?? '');
        const hasAccess = requiredPerms.every((p) => resolved.permissions.has(p));

        if (!hasAccess) {
          const url = request.nextUrl.clone();
          url.pathname = `/${workspaceSlug}/403`;
          return NextResponse.redirect(url);
        }

        // Cache the role slug in a response header
        if (resolved.role) {
          response.headers.set('x-user-role', resolved.role.slug);
        } else if (resolved.isOwner || resolved.isPlatformOwner) {
          response.headers.set('x-user-role', 'owner');
        }
      } catch {
        // Fail closed: if we can't determine permissions, deny access
        const url = request.nextUrl.clone();
        url.pathname = `/${workspaceSlug}/403`;
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
