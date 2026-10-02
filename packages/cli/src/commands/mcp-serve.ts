import type { Command } from 'commander';
import { loadConfig } from '../config-store.js';
import { createInterface } from 'readline';
import { DEFAULT_API_URL } from '../defaults.js';
import { cliCommand } from '../invocation.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Register the `mcp` command group and return the mcp Command so
 * subcommands (e.g. `install`) can be added by other modules.
 */
export function registerMcpCommand(program: Command): Command {
  const mcp = program.command('mcp').description('MCP server commands');

  mcp
    .command('serve')
    .description('Start as MCP stdio server (proxy to Celune HTTP endpoint)')
    .option('--api-url <url>', 'API base URL')
    .action(async (opts: { apiUrl?: string }) => {
      const config = loadConfig();
      if (!config) {
        const err: JsonRpcResponse = {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: `Not authenticated. Run: ${cliCommand()} setup`,
          },
        };
        process.stdout.write(JSON.stringify(err) + '\n');
        process.exit(1);
        return; // unreachable, but helps TS narrow config to non-null
      }

      const apiUrl = opts.apiUrl || DEFAULT_API_URL;
      const mcpEndpoint = `${apiUrl}/api/mcp`;
      const apiKey = config.apiKey;

      // Suppress all non-JSON output in MCP mode
      // Read JSON-RPC messages from stdin, proxy to HTTP, write response to stdout
      const rl = createInterface({ input: process.stdin });

      rl.on('line', async (line: string) => {
        if (!line.trim()) return;

        let request: JsonRpcRequest;
        try {
          request = JSON.parse(line) as JsonRpcRequest;
        } catch {
          const err: JsonRpcResponse = {
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
          };
          process.stdout.write(JSON.stringify(err) + '\n');
          return;
        }

        try {
          const res = await fetch(mcpEndpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
          });

          if (!res.ok) {
            const body = await res.text().catch(() => '');
            const err: JsonRpcResponse = {
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: -32603,
                message: `HTTP ${res.status}: ${body || res.statusText}`,
              },
            };
            process.stdout.write(JSON.stringify(err) + '\n');
            return;
          }

          const responseText = await res.text();
          // Pass through the response as-is (it should be valid JSON-RPC)
          process.stdout.write(responseText + '\n');
        } catch (err) {
          process.stderr.write(`[mcp-proxy] ${(err as Error).message}\n`);
          const errResponse: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32603,
              message: 'Internal proxy error',
            },
          };
          process.stdout.write(JSON.stringify(errResponse) + '\n');
        }
      });

      rl.on('close', () => {
        process.exit(0);
      });
    });

  return mcp;
}
