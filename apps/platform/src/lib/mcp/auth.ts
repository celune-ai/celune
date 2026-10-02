/**
 * MCP authentication helper.
 *
 * Runs the shared authenticator (API keys and host-minted JWTs) and converts
 * failures to JSON-RPC format so MCP clients (Cursor, Claude Code) display clear messages.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { mcpAccessError, type AuthContext } from '@celuneai/api';
import { createScope } from '@celuneai/core';
import { authenticateRequest } from '@/lib/api/host';
import { API_KEY_BEARER_PREFIX } from '@/lib/api-keys';
import { createPlatformGate } from '@/lib/gate';

function jsonRpcError(message: string, status: number, headers?: HeadersInit): NextResponse {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code: -32001, message }, id: null },
    { status, headers },
  );
}

export async function authenticate(request: NextRequest): Promise<AuthContext | NextResponse> {
  const result = await authenticateRequest(request);
  if (result.ok) {
    const refusal = mcpAccessError(result.auth);
    if (refusal) return jsonRpcError(refusal, 403);
    // The key's workspace must be usable before any tool runs, reads included (the paywall).
    const { auth } = result;
    const access = await createPlatformGate().check('workspace.access', {
      scope: createScope({
        workspaceId: auth.workspaceId,
        orgId: auth.orgId,
        actorId: auth.userId,
      }),
      userId: auth.userId,
    });
    if (access.allowed) return auth;
    const message = access.details?.message;
    return jsonRpcError(
      typeof message === 'string' ? message : access.reason,
      access.status ?? 403,
    );
  }
  const message =
    result.status === 401 && result.error === 'Authentication required'
      ? `API key required. Use Authorization: Bearer ${API_KEY_BEARER_PREFIX}...`
      : result.error;
  return jsonRpcError(message, result.status, result.headers);
}
