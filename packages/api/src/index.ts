export type { ApiScope, AuthContext, AuthFailure, AuthResult, Principal } from './auth/types.ts';
export { hasScope, isApiScope, isEmbedToken } from './auth/types.ts';
export {
  apiKeyPrefixLength,
  authenticateApiKey,
  constantTimeEqual,
  parseKeyEnvironment,
  sha256Hex,
} from './auth/api-key.ts';
export type { ApiKeyLookup, ApiKeyRecord, RateLimitVerdict } from './auth/api-key.ts';
export {
  MIN_HOST_JWT_SECRET_BYTES,
  assertHostJwtSecret,
  jwtConfigFromEnv,
  looksLikeJwt,
  mintHostJwt,
  verifyHostJwt,
} from './auth/jwt.ts';
export type { HostJwtClaims, HostJwtConfig, MintHostJwtOptions } from './auth/jwt.ts';
export { createAuthenticator, extractToken } from './auth/authenticate.ts';
export type { Authenticator, AuthenticatorOptions } from './auth/authenticate.ts';
export { resolveWorkspaceFor } from './host.ts';
export type {
  ApiHost,
  EmployedAgentSummary,
  JobCrypto,
  ResolvedWorkspace,
  ServerRunRequest,
  TaskChange,
  TaskContextEntry,
  ToolCallInfo,
  WorkspaceSummary,
} from './host.ts';
export { createApi, HEALTH_PATH } from './http/app.ts';
export type { ApiOptions } from './http/app.ts';
export type { ApiEnv } from './http/env.ts';
export { HttpError, errorToResponse, REQUEST_ID_HEADER } from './http/errors.ts';
export {
  EMBED_PERMISSION_KEYS,
  EMBED_WRITE_KEYS,
  embedTokenGrant,
  embedWritePermission,
  requirePermission,
} from './http/permissions.ts';
export { harnessEventAccessError } from './http/routes/harness.ts';
export type { RoutePermission } from './http/permissions.ts';
export { claimJob, heartbeatJob, redactJob, submitJobResult } from './jobs/index.ts';
export type { JobCallContext, JobOutcome, SubmitJobInput } from './jobs/index.ts';
export { errorResult, jsonResult, textResult } from './mcp/types.ts';
export type {
  McpToolGroup,
  McpToolHandler,
  McpToolResult,
  McpToolScope,
  ToolContext,
} from './mcp/types.ts';
export { isResolveError, resolveWorkspace, workspaceOverrideSchema } from './mcp/workspace.ts';
export type { ResolvedToolWorkspace } from './mcp/workspace.ts';
export { CORE_TOOLS, getAvailableTools, mergeTools, scopeSatisfied } from './mcp/registry.ts';
export { createMcpServer, handleMcpRequest, jsonRpcError, mcpAccessError } from './mcp/server.ts';
export type { HandleMcpOptions, McpServerOptions } from './mcp/server.ts';
