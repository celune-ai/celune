import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { requirePlatformOwner } from '@/lib/permissions';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

interface McpServerInfo {
  name: string;
  command: string;
  scope: 'global' | 'project';
}

/**
 * Returns configured MCP servers from Claude Code config files.
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'health.mcps.get', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  const authResult = await requirePlatformOwner(request);
  if (authResult instanceof NextResponse) return authResult;

  const servers: McpServerInfo[] = [];

  try {
    // Global config: ~/.claude.json
    const globalPath = join(homedir(), '.claude.json');
    if (existsSync(globalPath)) {
      const raw = JSON.parse(readFileSync(globalPath, 'utf-8'));
      const mcps = raw?.mcpServers ?? {};
      for (const [name, cfg] of Object.entries(mcps)) {
        const c = cfg as Record<string, unknown>;
        servers.push({
          name,
          command:
            typeof c.command === 'string' ? (c.command.split('/').pop() ?? c.command) : 'unknown',
          scope: 'global',
        });
      }

      // Project-level MCPs nested under projects key
      const projects = raw?.projects ?? {};
      for (const projectCfg of Object.values(projects)) {
        const pc = projectCfg as Record<string, unknown>;
        const projectMcps = (pc?.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
        for (const [name, cfg] of Object.entries(projectMcps)) {
          // Skip duplicates
          if (servers.some((s) => s.name === name)) continue;
          servers.push({
            name,
            command:
              typeof cfg.command === 'string'
                ? (cfg.command.split('/').pop() ?? cfg.command)
                : 'unknown',
            scope: 'project',
          });
        }
      }
    }
  } catch {
    // Ignore parse errors
  }

  return NextResponse.json({
    total: servers.length,
    servers,
  });
}
