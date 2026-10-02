/**
 * Centralized API security wrapper.
 *
 * Combines CSRF validation, rate limiting, auth, permission checks,
 * and body parsing into a single composable wrapper. Reduces per-route
 * boilerplate from ~10 lines to 1 line of config.
 *
 * Usage:
 *   export const POST = withApiSecurity(
 *     async (request, { userId, body }) => {
 *       // handler logic — userId is guaranteed non-null
 *       return NextResponse.json({ ok: true });
 *     },
 *     { permission: 'tasks:create', rateLimit: RATE_WRITE, parseBody: createTaskSchema },
 *   );
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ZodSchema } from 'zod';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, type RateLimitResult } from '@/lib/rate-limiter';
import { getAuthUserId } from '@/lib/auth';
import { requirePermission, requirePlatformOwner, type PermissionContext } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { requireActivePlan as checkActivePlan } from '@/lib/plan-enforcement';
import type { PermissionKey } from '@repo/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RateLimitTier {
  limit: number;
  windowMs: number;
}

export interface ApiSecurityOptions<TBody = unknown> {
  /** Rate limit tier (e.g. RATE_WRITE, RATE_READ, RATE_AI). */
  rateLimit?: { tier: RateLimitTier; routeKey: string };

  /**
   * Permission key(s) for requirePermission check, against the workspace in the
   * workspace_id query param, or the body's workspace_id when the query has none.
   * Without either workspace only the platform owner passes.
   */
  permission?: PermissionKey | PermissionKey[];
  /** Platform-wide route: only the platform owner passes, whatever workspace_id says. */
  platformOwner?: boolean;

  /**
   * Enable CSRF origin validation.
   * Defaults to true for write methods (POST/PUT/PATCH/DELETE).
   * Set to false to disable (e.g. for webhook receivers).
   */
  csrf?: boolean;

  /** Zod schema to parse and validate the request body. */
  parseBody?: ZodSchema<TBody>;

  /**
   * Require authentication.
   * Defaults to true. Set to false for public endpoints.
   */
  requireAuth?: boolean;

  /**
   * Enforce the paywall (blocks workspaces whose org has no active plan).
   * Defaults to true when requireAuth is true.
   * Set to false for billing/checkout, plan info, and other endpoints
   * that must remain accessible before the org subscribes.
   *
   * Requires workspace_id in query params. If workspace_id is absent,
   * the check is skipped (route may not be workspace-scoped).
   */
  enforcePaywall?: boolean;
}

export interface SecurityContext<TBody = unknown> {
  /** Authenticated user ID. Guaranteed non-null when requireAuth is true (default). */
  userId: string;

  /** Parsed and validated request body (only present when parseBody is provided). */
  body: TBody;

  /** Permission context from requirePermission (only present when permission is provided). */
  permissionContext?: PermissionContext;
}

type RouteHandler = (request: NextRequest) => Promise<NextResponse>;

// ─── Write methods that get CSRF protection by default ──────────────────────

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ─── Wrapper ────────────────────────────────────────────────────────────────

/**
 * Wraps an API route handler with security middleware.
 *
 * Execution order:
 *   1. CSRF origin validation (write methods only, unless overridden)
 *   2. Rate limiting (if configured)
 *   3. Authentication (unless requireAuth=false and no permission is configured)
 *   4. Body parsing + Zod validation (if configured)
 *   5. Permission check (if configured), on the query or body workspace_id
 *   6. Paywall (blocks unpaid workspaces, unless enforcePaywall=false)
 *   7. Handler invocation
 *   8. Error catch → safeErrorResponse
 */
export function withApiSecurity<TBody = unknown>(
  handler: (request: NextRequest, context: SecurityContext<TBody>) => Promise<NextResponse>,
  options: ApiSecurityOptions<TBody> = {},
): RouteHandler {
  const {
    rateLimit,
    permission,
    platformOwner,
    csrf,
    parseBody: bodySchema,
    requireAuth = true,
    enforcePaywall,
  } = options;
  // Default enforcePaywall to true when auth is required, unless explicitly disabled
  const shouldEnforcePaywall = enforcePaywall ?? requireAuth;

  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      // 1. CSRF — default on for write methods
      const isWrite = WRITE_METHODS.has(request.method);
      const shouldCheckCsrf = csrf ?? isWrite;
      if (shouldCheckCsrf) {
        const originError = await validateOrigin(request);
        if (originError) return originError;
      }

      // 2. Rate limiting
      if (rateLimit) {
        const rateLimitResult = await applyRateLimit(request, rateLimit.routeKey, rateLimit.tier);
        if (rateLimitResult) return rateLimitResult.blocked;
      }

      // 3. Auth (requirePermission / requirePlatformOwner authenticate on their own)
      const checksPermission = Boolean(permission || platformOwner);
      let userId: string | null = null;
      if (!checksPermission) {
        userId = getAuthUserId(request);
        if (!userId && requireAuth) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        userId = userId ?? '';
      }

      let permissionContext: PermissionContext | undefined;
      if (platformOwner) {
        const result = await requirePlatformOwner(request);
        if (result instanceof NextResponse) return result;
        userId = result.userId;
        permissionContext = result;
      }

      // 4. Body parsing (before the permission check, which may need body.workspace_id)
      let body: TBody = undefined as TBody;
      if (bodySchema) {
        const parsed = await parseBody(request, bodySchema);
        if (isErrorResponse(parsed)) return parsed;
        body = parsed;
      }

      // 5. Permission
      const queryWorkspaceId = request.nextUrl.searchParams.get('workspace_id');
      const bodyValue = body as unknown as { workspace_id?: unknown } | undefined;
      const bodyWorkspaceId =
        typeof bodyValue?.workspace_id === 'string' ? bodyValue.workspace_id : null;
      if (queryWorkspaceId && bodyWorkspaceId && queryWorkspaceId !== bodyWorkspaceId) {
        return NextResponse.json(
          { error: 'workspace_id in body must match query parameter' },
          { status: 400 },
        );
      }
      const workspaceId = queryWorkspaceId ?? bodyWorkspaceId;

      if (permission) {
        const keys = Array.isArray(permission) ? permission : [permission];
        const result = await requirePermission(request, workspaceId, ...keys);
        if (result instanceof NextResponse) return result;
        userId = result.userId;
        permissionContext = result;
      }

      // 6. Paywall — block workspaces whose org has no active plan
      if (shouldEnforcePaywall && userId && workspaceId) {
        const blocked = await checkActivePlan({ workspaceId, userId });
        if (blocked) return blocked;
      }

      // 7. Handler
      return await handler(request, {
        userId: userId!,
        body,
        permissionContext,
      });
    } catch (error) {
      // 8. Error catch
      return safeErrorResponse(error);
    }
  };
}
