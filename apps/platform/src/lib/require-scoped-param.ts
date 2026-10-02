/**
 * IDOR Prevention — Scoped Parameter Extraction
 *
 * Any ID that determines which org/workspace/tenant a resource belongs to
 * MUST come from query params or the authenticated session, NEVER from the
 * request body. This helper enforces that pattern.
 *
 * Usage:
 *   const workspaceId = requireScopedParam(request, 'workspace_id');
 *   // workspaceId is now guaranteed to come from the query string.
 *   // Pass it to requirePermission() for authorization.
 *
 * Why:
 *   Accepting scope IDs from the body allows a caller to authenticate
 *   against workspace A while writing to workspace B (IDOR).
 *   The query param is visible in logs and easier to audit.
 *
 * IDOR Prevention Checklist for Code Review:
 *   1. workspace_id, org_id NEVER read from request body
 *   2. Scope IDs come from query params or JWT claims
 *   3. requirePermission() is called with the scoped ID before any DB write
 *   4. Resource ownership is verified (e.g., key belongs to caller's org)
 *   5. No user-supplied ID is trusted for cross-tenant lookups
 */

import type { NextRequest } from 'next/server';

/**
 * Extract a required scoped parameter from the query string.
 * Returns the value or null if not present.
 */
export function getScopedParam(request: NextRequest, param: string): string | null {
  return request.nextUrl.searchParams.get(param);
}

/**
 * Extract a required scoped parameter, throwing if absent.
 */
export function requireScopedParam(request: NextRequest, param: string): string {
  const value = request.nextUrl.searchParams.get(param);
  if (!value) {
    throw new Error(`Missing required query parameter: ${param}`);
  }
  return value;
}
