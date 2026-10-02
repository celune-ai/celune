import type { Context, MiddlewareHandler } from 'hono';
import type { TaskChange } from '../host.ts';
import type { ApiEnv } from './env.ts';
import { HttpError } from './errors.ts';

/** Host RBAC keys a v1 route can require, matching the platform's permission names. */
export type RoutePermission =
  | 'tasks:read'
  | 'projects:read'
  | 'agents:read'
  | 'analytics:read'
  | 'tasks:create'
  | 'tasks:update'
  | 'tasks:delete'
  | 'projects:create'
  | 'projects:update'
  | 'projects:delete'
  | 'agents:configure';

/** Refuses the request when the token carries RBAC keys and lacks this one. */
export function requirePermission(c: Context<ApiEnv>, key: RoutePermission): void {
  const granted = c.var.auth.permissions;
  if (granted && !granted.includes(key)) {
    throw new HttpError(403, 'Forbidden', { required: key });
  }
}

/**
 * Read side of requirePermission: GET and HEAD requests need the key the
 * route family maps to. API keys carry no RBAC keys, so only scopes apply.
 */
export function requireReadPermission(
  key: RoutePermission | ((c: Context<ApiEnv>) => RoutePermission),
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') {
      requirePermission(c, typeof key === 'function' ? key(c) : key);
    }
    await next();
  };
}

/** Runs the host's task-change hook without letting its failure fail the write. */
export async function notifyTaskChange(c: Context<ApiEnv>, change: TaskChange): Promise<void> {
  const hook = c.var.host.tasks?.onChange;
  if (!hook) return;
  try {
    await hook(change);
  } catch (error) {
    console.warn('[celune-api] task change hook failed', error);
  }
}

const ID = '[^/]+';

/**
 * The key each mutating v1 route needs from an embed token. A route missing
 * here refuses embed tokens, so a new write route stays closed to browsers
 * until it names the key it needs.
 */
const EMBED_WRITE_ROUTES: Array<[method: string, path: RegExp, key: RoutePermission]> = [
  ['POST', /^\/tasks$/, 'tasks:create'],
  ['PUT', /^\/tasks\/reorder$/, 'tasks:update'],
  ['PATCH', new RegExp(`^/tasks/${ID}$`), 'tasks:update'],
  ['DELETE', new RegExp(`^/tasks/${ID}$`), 'tasks:delete'],
  [
    'POST',
    new RegExp(`^/tasks/${ID}/(initiate|attachments|claim|complete|block|unblock|comments)$`),
    'tasks:update',
  ],
  ['DELETE', new RegExp(`^/tasks/${ID}/attachments/${ID}$`), 'tasks:update'],
  ['POST', /^\/projects$/, 'projects:create'],
  ['PUT', /^\/projects\/reorder$/, 'projects:update'],
  ['PATCH', new RegExp(`^/projects/${ID}$`), 'projects:update'],
  ['DELETE', new RegExp(`^/projects/${ID}$`), 'projects:delete'],
  ['POST', new RegExp(`^/jobs/${ID}/cancel$`), 'tasks:update'],
  ['POST', /^\/executions\/cancel$/, 'tasks:update'],
  ['PUT', new RegExp(`^/agents/${ID}/status$`), 'agents:configure'],
  ['POST', /^\/agents\/heartbeat$/, 'agents:configure'],
];

/** The key an embed token needs for a mutating request, or null when the route refuses embed tokens. */
export function embedWritePermission(method: string, path: string): RoutePermission | null {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  for (const [m, pattern, key] of EMBED_WRITE_ROUTES) {
    if (m === method && pattern.test(trimmed)) return key;
  }
  return null;
}

/** Keys that unlock at least one v1 write for an embed token. */
export const EMBED_WRITE_KEYS: readonly RoutePermission[] = [
  ...new Set(EMBED_WRITE_ROUTES.map(([, , key]) => key)),
];

/**
 * Task and project keys v1 checks. Hosts minting embed tokens copy only these
 * from the user's grants, and ask for `write` only when one of them is a write key.
 */
export const EMBED_PERMISSION_KEYS: readonly RoutePermission[] = [
  'tasks:read',
  'tasks:create',
  'tasks:update',
  'tasks:delete',
  'projects:read',
  'projects:create',
  'projects:update',
  'projects:delete',
];

/** Scopes and permissions claim for an embed token, from the keys the user holds. */
export function embedTokenGrant(granted: Iterable<string>): {
  scopes: Array<'read' | 'write'>;
  permissions: RoutePermission[];
} {
  const held = new Set(granted);
  const permissions = EMBED_PERMISSION_KEYS.filter((key) => held.has(key));
  const canWrite = permissions.some((key) => EMBED_WRITE_KEYS.includes(key));
  return { scopes: canWrite ? ['write'] : ['read'], permissions };
}
