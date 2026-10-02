import { Hono } from 'hono';
import type { AuthContext } from '../../auth/types.ts';
import {
  createMcpServer,
  handleMcpRequest,
  jsonRpcError,
  mcpAccessError,
} from '../../mcp/server.ts';
import type { McpToolHandler, ToolContext } from '../../mcp/types.ts';
import type { ApiEnv } from '../env.ts';

export interface McpRouteOptions {
  instructions?: (auth: AuthContext) => Promise<string | undefined> | string | undefined;
  extraTools?: McpToolHandler[];
  extendContext?: (ctx: ToolContext) => ToolContext;
  serverInfo?: { name: string; version: string };
  enableJsonResponse?: boolean;
}

export function mcp(options: McpRouteOptions = {}): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();

  router.post('/', async (c) => {
    const auth = c.var.auth;
    const refusal = mcpAccessError(auth);
    if (refusal) return jsonRpcError(-32001, refusal, 403);
    const base: ToolContext = { auth, services: c.var.services, host: c.var.host };
    const context = options.extendContext ? options.extendContext(base) : base;
    const instructions = await options.instructions?.(auth);
    const server = createMcpServer({
      auth,
      context,
      extraTools: options.extraTools,
      instructions: instructions || undefined,
      serverInfo: options.serverInfo,
      onToolCall: ({ tool }) =>
        c.var.host.onToolCall?.({ auth, tool, workspaceId: auth.workspaceId }),
    });
    try {
      return await handleMcpRequest(server, c.req.raw, {
        enableJsonResponse: options.enableJsonResponse,
      });
    } catch (error) {
      console.error(
        '[celune-api] mcp request failed:',
        error instanceof Error ? error.message : error,
      );
      return jsonRpcError(-32603, 'Internal error', 500);
    }
  });

  router.get('/', () =>
    jsonRpcError(-32000, 'Use POST for MCP tool calls; this server is stateless.', 405),
  );
  router.delete('/', () =>
    jsonRpcError(-32000, 'Session termination not supported in stateless mode.', 405),
  );

  return router;
}
