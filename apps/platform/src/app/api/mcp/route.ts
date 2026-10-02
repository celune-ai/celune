export const dynamic = 'force-dynamic';

import { type NextRequest, NextResponse } from 'next/server';
import { createMcpServer, handleMcpRequest } from '@celuneai/api';
import { createServiceClient } from '@repo/db/service';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { platformHost, platformServices } from '@/lib/api/host';
import { authenticate } from '@/lib/mcp/auth';
import { getInstructions } from '@/lib/mcp/instructions-cache';
import { getAvailableTools } from '@/lib/mcp/registry';
import type { ToolContext } from '@/lib/mcp/types';

// ---------------------------------------------------------------------------
// Route handlers — Stateless Streamable HTTP
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'mcp.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  // 1. Authenticate: API key or host-minted JWT (required for all MCP requests)
  const auth = await authenticate(request);
  if (auth instanceof NextResponse) return auth;

  // Skip CSRF origin check — MCP requests are authenticated via bearer tokens,
  // not browser cookies. IDE clients (Cursor, Claude Code) don't send Origin headers.

  try {
    // 2. Read request body and check for MCP initialize (captures client identity)
    const bodyText = await request.text();
    const userAgent = request.headers.get('user-agent');

    let clientInfo: { name?: string; version?: string; plan?: string; title?: string } | null =
      null;
    try {
      const body = JSON.parse(bodyText);
      const messages = Array.isArray(body) ? body : [body];
      for (const msg of messages) {
        if (msg.method === 'initialize' && msg.params?.clientInfo) {
          clientInfo = msg.params.clientInfo;
          break;
        }
      }
    } catch {
      // Not valid JSON — transport will handle the error
    }

    const supabase = createServiceClient();

    // Store client metadata on the key (fire-and-forget, only on initialize)
    if (clientInfo && auth.keyId) {
      supabase
        .from('api_keys')
        .update({
          client_metadata: {
            name: clientInfo.name ?? null,
            version: clientInfo.version ?? null,
            plan: clientInfo.plan ?? clientInfo.title ?? null,
            user_agent: userAgent,
            updated_at: new Date().toISOString(),
          },
        })
        .eq('id', auth.keyId)
        .then(
          () => {},
          () => {},
        );
    }

    // 3. Build the workspace-scoped MCP server from the shared registry
    const instructions = await getInstructions(auth);
    const context: ToolContext = {
      auth,
      services: platformServices(),
      host: platformHost,
      supabase,
    };
    const server = createMcpServer({
      auth,
      context,
      tools: getAvailableTools(auth),
      instructions,
      onToolCall: ({ tool }) =>
        platformHost.onToolCall?.({ auth, tool, workspaceId: auth.workspaceId }),
    });

    // 4. Reconstruct request with consumed body for the stateless transport
    const mcpRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bodyText,
    });

    // 5. Handle the MCP request — returns a standard Response (supports SSE streaming)
    return await handleMcpRequest(server, mcpRequest);
  } catch (e) {
    console.error('[mcp] Request handler error:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  // Check if this is a browser hitting the endpoint (OAuth discovery or direct visit)
  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('text/html')) {
    return new Response(
      `<!DOCTYPE html>
<html><head><title>Celune MCP</title></head>
<body style="font-family:system-ui;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center;max-width:480px;padding:2rem">
<h1 style="font-size:1.5rem;font-weight:500">Celune MCP Server</h1>
<p style="color:#999;margin:1rem 0">This endpoint accepts MCP protocol requests via POST with API key authentication.</p>
<p style="color:#999">To connect your IDE, generate an API key in your <a href="/" style="color:#5BC586">Celune dashboard</a> and add it to your IDE's MCP config.</p>
</div>
</body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // MCP Streamable HTTP spec: GET establishes SSE stream for server-initiated messages
  // Redirect to dedicated stream endpoint for real-time events
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message:
          'Use POST for MCP tool calls. For real-time SSE stream, connect to /api/mcp/stream with your API key.',
      },
      id: null,
      stream_url: '/api/mcp/stream',
    },
    { status: 405 },
  );
}

export async function DELETE(request: Request) {
  const rateLimitResult = await applyRateLimit(request as NextRequest, 'mcp.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  // No CSRF check — MCP uses API key auth, not browser cookies

  return NextResponse.json(
    {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Session termination not supported in stateless mode.' },
      id: null,
    },
    { status: 405 },
  );
}
