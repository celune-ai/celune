import { authenticateApiKey, type ApiKeyLookup } from './api-key.ts';
import { looksLikeJwt, verifyHostJwt, type HostJwtConfig } from './jwt.ts';
import { failure, type AuthResult } from './types.ts';

export type Authenticator = (request: Request) => Promise<AuthResult>;

export interface AuthenticatorOptions {
  /** Key prefix from host config (`celune` by default upstream). */
  apiKeyPrefix: string;
  apiKeys?: ApiKeyLookup;
  jwt?: HostJwtConfig;
}

export function extractToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header) {
    const [scheme, ...rest] = header.trim().split(/\s+/);
    if (scheme?.toLowerCase() === 'bearer' && rest.length === 1) return rest[0]!;
  }
  return request.headers.get('x-api-key');
}

/** Picks the path by token shape: prefix match is an API key, three segments is a JWT. */
export function createAuthenticator(options: AuthenticatorOptions): Authenticator {
  const bearerPrefix = `${options.apiKeyPrefix}_`;
  return async (request) => {
    const token = extractToken(request);
    if (!token) return failure(401, 'Authentication required');
    if (token.startsWith(bearerPrefix)) {
      if (!options.apiKeys) return failure(401, 'API keys are not enabled on this host');
      return authenticateApiKey(token, {
        apiKeyPrefix: options.apiKeyPrefix,
        lookup: options.apiKeys,
      });
    }
    if (looksLikeJwt(token)) {
      if (!options.jwt) return failure(401, 'Host tokens are not enabled on this host');
      return verifyHostJwt(token, options.jwt);
    }
    return failure(401, 'Invalid credentials format');
  };
}
