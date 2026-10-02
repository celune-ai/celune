/**
 * Celune embed: org to workspace resolution and the short-lived host JWT the
 * browser uses against the Celune sidecar. Server only; the signing secret
 * never reaches the client.
 *
 * Env:
 *   CELUNE_API_URL          browser-reachable Celune API base, for example https://celune.internal/v1
 *   CELUNE_HOST_JWT_SECRET  HS256 secret shared with the sidecar, 32 bytes or more
 *   CELUNE_WORKSPACES       JSON map of Headways org slug to Celune workspace id
 */
import { createHmac } from 'node:crypto';
import { requireActiveOrg } from '#server/session.server.js';

const TOKEN_TTL_SECONDS = 15 * 60;

type OrgRole = 'owner' | 'admin' | 'member' | 'viewer' | string;

const READ = ['tasks:read', 'projects:read', 'agents:read', 'analytics:read'];
const WRITE = ['tasks:create', 'tasks:update', 'projects:create', 'projects:update'];
const MANAGE = ['tasks:delete', 'projects:delete', 'agents:configure'];

/** Celune RBAC keys for a Headways org role. The permissions claim marks this token as a browser embed token. */
export function celunePermissionsFor(role: OrgRole): { scopes: string[]; permissions: string[] } {
  if (role === 'owner' || role === 'admin') {
    return { scopes: ['write'], permissions: [...READ, ...WRITE, ...MANAGE] };
  }
  if (role === 'member') return { scopes: ['write'], permissions: [...READ, ...WRITE] };
  return { scopes: ['read'], permissions: READ };
}

export interface CeluneEmbed {
  apiUrl: string;
  workspaceId: string;
  token: string;
  canEdit: boolean;
}

/** Read once when the server starts, so a bad value fails there with a clear message. */
const CONFIG = readConfig();

function readConfig() {
  const apiUrl = process.env.CELUNE_API_URL?.trim();
  const secret = process.env.CELUNE_HOST_JWT_SECRET?.trim();
  const workspaces = process.env.CELUNE_WORKSPACES?.trim();
  if (!apiUrl || !secret || !workspaces) return null;
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('CELUNE_HOST_JWT_SECRET must be at least 32 bytes');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(workspaces);
  } catch {
    throw new Error('CELUNE_WORKSPACES must be a JSON object of org slug to workspace id');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CELUNE_WORKSPACES must be a JSON object of org slug to workspace id');
  }
  return { apiUrl, secret, workspaces: parsed as Record<string, string> };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const head = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url(payload);
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

/**
 * Resolves the active org, maps it to its Celune workspace, and mints an embed
 * token for the signed-in user. Returns null when the embed is not configured
 * for this org, so the page can render an empty state.
 */
export async function loadCeluneEmbed(
  request: Request,
  orgSlug?: string,
): Promise<CeluneEmbed | null> {
  const { session, org, role } = await requireActiveOrg(request, orgSlug);
  const cfg = CONFIG;
  const workspaceId = cfg?.workspaces[org.slug];
  if (!cfg || !workspaceId) return null;

  const { scopes, permissions } = celunePermissionsFor(role);
  const now = Math.floor(Date.now() / 1000);
  const token = signHs256(
    {
      sub: session.user.id,
      workspace_id: workspaceId,
      org_id: org.id,
      scopes,
      permissions,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    },
    cfg.secret,
  );
  return { apiUrl: cfg.apiUrl, workspaceId, token, canEdit: scopes.includes('write') };
}
