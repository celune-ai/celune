import { SignJWT } from 'jose';

const MIN_SECRET_BYTES = 32;

export interface ServerTokenClaims {
  /** Celune principal id. For an agent token this is the Celune agent id. */
  sub: string;
  workspaceId: string;
  orgId?: string | null;
}

export interface ServerTokenOptions {
  /** The HS256 secret Celune reads from CELUNE_HOST_JWT_SECRET. */
  secret: string;
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
}

/**
 * Signs a server JWT: write scope and no permissions claim. Celune refuses
 * tokens that carry permissions on /v1/mcp and /v1/harness/events, because
 * those claims mark a browser embed token.
 */
export async function mintServerToken(
  claims: ServerTokenClaims,
  options: ServerTokenOptions,
): Promise<string> {
  if (new TextEncoder().encode(options.secret).length < MIN_SECRET_BYTES) {
    throw new Error(`Host JWT secret must be at least ${MIN_SECRET_BYTES} bytes`);
  }
  let jwt = new SignJWT({
    workspace_id: claims.workspaceId,
    org_id: claims.orgId ?? null,
    scopes: ['write'],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${options.expiresInSeconds ?? 600}s`);
  if (options.issuer) jwt = jwt.setIssuer(options.issuer);
  if (options.audience) jwt = jwt.setAudience(options.audience);
  return jwt.sign(new TextEncoder().encode(options.secret));
}
