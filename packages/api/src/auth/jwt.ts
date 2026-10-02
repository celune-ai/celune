import {
  SignJWT,
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import { failure, isApiScope, type ApiScope, type AuthResult } from './types.ts';

/**
 * Host-minted JWT verification. Exactly one of secret (HS256), jwksUrl, or
 * getKey must be set; getKey exists so tests and hosts can inject a local key set.
 */
export interface HostJwtConfig {
  secret?: string;
  jwksUrl?: string;
  getKey?: JWTVerifyGetKey;
  issuer?: string;
  audience?: string;
}

export interface HostJwtClaims {
  sub: string;
  workspace_id: string;
  org_id?: string | null;
  scopes: ApiScope[];
  /** Optional host RBAC keys; see AuthContext.permissions. */
  permissions?: string[];
}

/** HS256 keys shorter than the 256-bit hash output can be brute forced offline. */
export const MIN_HOST_JWT_SECRET_BYTES = 32;

/** Throws when the HS256 secret is too short. The message never includes the secret. */
export function assertHostJwtSecret(secret: string): void {
  const bytes = new TextEncoder().encode(secret).byteLength;
  if (bytes < MIN_HOST_JWT_SECRET_BYTES) {
    throw new Error(
      `CELUNE_HOST_JWT_SECRET must be at least ${MIN_HOST_JWT_SECRET_BYTES} bytes (got ${bytes}). ` +
        'Generate one with: openssl rand -hex 32',
    );
  }
}

/** Reads host JWT settings; throws on a secret shorter than MIN_HOST_JWT_SECRET_BYTES. */
export function jwtConfigFromEnv(
  env: Record<string, string | undefined>,
): HostJwtConfig | undefined {
  const secret = env.CELUNE_HOST_JWT_SECRET?.trim();
  const jwksUrl = env.CELUNE_HOST_JWKS_URL?.trim();
  if (!secret && !jwksUrl) return undefined;
  if (secret) assertHostJwtSecret(secret);
  return {
    secret: secret || undefined,
    jwksUrl: jwksUrl || undefined,
    issuer: env.CELUNE_HOST_JWT_ISSUER?.trim() || undefined,
    audience: env.CELUNE_HOST_JWT_AUDIENCE?.trim() || undefined,
  };
}

export function looksLikeJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

function keyFor(config: HostJwtConfig): {
  key: Uint8Array | JWTVerifyGetKey;
  algorithms?: string[];
} {
  if (config.getKey) return { key: config.getKey };
  if (config.secret) {
    assertHostJwtSecret(config.secret);
    return { key: new TextEncoder().encode(config.secret), algorithms: ['HS256'] };
  }
  if (config.jwksUrl) {
    let getKey = jwksCache.get(config.jwksUrl);
    if (!getKey) {
      getKey = createRemoteJWKSet(new URL(config.jwksUrl));
      jwksCache.set(config.jwksUrl, getKey);
    }
    // Asymmetric only, so a JWKS host can never be verified as HS256.
    return { key: getKey, algorithms: ['RS256', 'ES256', 'EdDSA'] };
  }
  throw new Error('Host JWT verification needs a secret, a JWKS URL, or a key resolver');
}

export async function verifyHostJwt(token: string, config: HostJwtConfig): Promise<AuthResult> {
  const { key, algorithms } = keyFor(config);
  let payload: Record<string, unknown>;
  try {
    // jwtVerify's key overloads differ by resolver type; both branches share one options object
    const verifyOptions = {
      algorithms,
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ['exp', 'sub', 'workspace_id'],
    };
    const result =
      typeof key === 'function'
        ? await jwtVerify(token, key, verifyOptions)
        : await jwtVerify(token, key, verifyOptions);
    payload = result.payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) return failure(401, 'Token expired');
    return failure(401, 'Invalid token');
  }

  const sub = payload.sub;
  const workspaceId = payload.workspace_id;
  if (typeof sub !== 'string' || !sub || typeof workspaceId !== 'string' || !workspaceId) {
    return failure(401, 'Token is missing sub or workspace_id');
  }
  const rawScopes = Array.isArray(payload.scopes) ? payload.scopes : [];
  const scopes = rawScopes.filter(isApiScope) as ApiScope[];
  if (scopes.length === 0) return failure(403, 'Token grants no scopes');
  const orgId = typeof payload.org_id === 'string' ? payload.org_id : null;
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.filter((p): p is string => typeof p === 'string')
    : undefined;

  return {
    ok: true,
    auth: {
      principal: 'jwt',
      workspaceId,
      orgId,
      userId: sub,
      scopes,
      keyId: null,
      environment: 'live',
      realtimeEnabled: false,
      ...(permissions ? { permissions } : {}),
    },
  };
}

export interface MintHostJwtOptions {
  /** The same HS256 secret the verifier reads from CELUNE_HOST_JWT_SECRET. */
  secret: string;
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
}

/** Signs a short-lived HS256 host JWT; hosts call this server-side and hand the token to the browser. */
export function mintHostJwt(claims: HostJwtClaims, options: MintHostJwtOptions): Promise<string> {
  assertHostJwtSecret(options.secret);
  const payload: Record<string, unknown> = {
    workspace_id: claims.workspace_id,
    org_id: claims.org_id ?? null,
    scopes: claims.scopes,
  };
  if (claims.permissions) payload.permissions = claims.permissions;
  let jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${options.expiresInSeconds ?? 600}s`);
  if (options.issuer) jwt = jwt.setIssuer(options.issuer);
  if (options.audience) jwt = jwt.setAudience(options.audience);
  return jwt.sign(new TextEncoder().encode(options.secret));
}
