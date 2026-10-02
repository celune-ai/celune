export type ApiScope = 'read' | 'write' | 'admin';

export type Principal = 'api_key' | 'jwt';

/** One identity for both principals; every handler and MCP tool reads this. */
export interface AuthContext {
  principal: Principal;
  workspaceId: string;
  orgId: string | null;
  userId: string;
  scopes: ApiScope[];
  /** Set for API keys; null for host-minted JWTs, which cannot claim jobs. */
  keyId: string | null;
  environment: 'live' | 'test';
  realtimeEnabled: boolean;
  /**
   * Host RBAC keys such as `tasks:delete`, from a host JWT's `permissions` claim.
   * When set, mutating routes also require the matching key; undefined means scopes alone decide.
   */
  permissions?: string[];
}

export interface AuthFailure {
  ok: false;
  status: 401 | 403 | 429 | 503;
  error: string;
  headers?: Record<string, string>;
}

export type AuthResult = { ok: true; auth: AuthContext } | AuthFailure;

export const SCOPE_ORDER: Record<ApiScope, number> = { read: 0, write: 1, admin: 2 };

export function isApiScope(value: unknown): value is ApiScope {
  return value === 'read' || value === 'write' || value === 'admin';
}

/**
 * Host JWTs minted for a browser embed carry a permissions claim. They must not
 * report harness events or start agent runs, which spend the host's budget.
 */
export function isEmbedToken(auth: Pick<AuthContext, 'principal' | 'permissions'>): boolean {
  return auth.principal === 'jwt' && auth.permissions !== undefined;
}

/** admin includes write, write includes read. */
export function hasScope(auth: Pick<AuthContext, 'scopes'>, required: ApiScope): boolean {
  const need = SCOPE_ORDER[required];
  return auth.scopes.some((scope) => SCOPE_ORDER[scope] >= need);
}

export function failure(
  status: AuthFailure['status'],
  error: string,
  headers?: Record<string, string>,
): AuthFailure {
  return { ok: false, status, error, headers };
}
