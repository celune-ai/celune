import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isEmbedToken, type AuthContext } from '../auth/types.ts';
import { CORE_TOOLS, getAvailableTools, mergeTools } from './registry.ts';
import type { McpToolHandler, ToolContext } from './types.ts';

export interface McpServerOptions<Ctx extends ToolContext = ToolContext> {
  auth: AuthContext;
  context: Ctx;
  /** Full tool set; defaults to the package tools. */
  tools?: McpToolHandler<Ctx>[];
  extraTools?: McpToolHandler<Ctx>[];
  instructions?: string;
  serverInfo?: { name: string; version: string };
  /** Runs after each tool call, for activity logging; failures are swallowed. */
  onToolCall?: (info: { tool: string; auth: AuthContext; params: Record<string, unknown> }) => void;
}

/**
 * MCP is for agents with API keys. Host JWTs that carry a `permissions` claim
 * are browser embed tokens, and the tool registry does not map tools to
 * permission keys, so those tokens are refused here instead of bypassing them.
 * Returns the refusal message, or null when the principal may use MCP.
 */
export function mcpAccessError(auth: AuthContext): string | null {
  if (isEmbedToken(auth)) {
    return 'Embed tokens cannot call MCP. Use an API key.';
  }
  return null;
}

export function createMcpServer<Ctx extends ToolContext>(
  options: McpServerOptions<Ctx>,
): McpServer {
  const refusal = mcpAccessError(options.auth);
  if (refusal) throw new Error(refusal);
  const server = new McpServer(
    options.serverInfo ?? { name: 'celune', version: '1.0.0' },
    options.instructions ? { instructions: options.instructions } : undefined,
  );
  const tools = mergeTools(
    options.tools ?? (CORE_TOOLS as McpToolHandler<Ctx>[]),
    options.extraTools,
  );

  for (const tool of getAvailableTools(options.auth, tools)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema.shape },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (params: any) => {
        const args = (params ?? {}) as Record<string, unknown>;
        const result = await tool.execute(args, options.context);
        try {
          options.onToolCall?.({ tool: tool.name, auth: options.auth, params: args });
        } catch {
          // logging must never fail the call
        }
        return result;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
  }
  return server;
}

export interface HandleMcpOptions {
  enableJsonResponse?: boolean;
}

/** One stateless Streamable HTTP exchange: connect, answer, done. */
export async function handleMcpRequest(
  server: McpServer,
  request: Request,
  options: HandleMcpOptions = {},
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: options.enableJsonResponse ?? false,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export function jsonRpcError(
  code: number,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null, ...extra }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}
