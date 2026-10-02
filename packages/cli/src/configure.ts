import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

import { DEFAULT_MCP_URL } from './defaults.js';

export interface ConfigureResult {
  toolName: string;
  configPath: string;
  action: 'created' | 'updated' | 'error';
  error?: string;
}

function getCeluneServerConfig(apiKey: string, mcpUrl?: string) {
  return {
    type: 'http' as const,
    url: mcpUrl ?? DEFAULT_MCP_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  };
}

/**
 * Write Celune MCP server config into a single tool's config file.
 * Reads the existing file (if any), merges `mcpServers.celune` without
 * clobbering other servers, creates parent dirs as needed, and writes
 * back with 2-space indent.
 */
export async function configureToolMcp(
  configPath: string,
  apiKey: string,
  toolName: string,
): Promise<ConfigureResult> {
  try {
    let config: Record<string, unknown> = {};
    const existed = existsSync(configPath);

    if (existed) {
      const raw = readFileSync(configPath, 'utf8');
      try {
        config = JSON.parse(raw);
      } catch {
        return { toolName, configPath, action: 'error', error: `Invalid JSON in ${configPath}` };
      }
    }

    // Merge — preserve other MCP servers
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      config.mcpServers = {};
    }
    (config.mcpServers as Record<string, unknown>).celune = getCeluneServerConfig(apiKey);

    // Ensure parent directories exist
    mkdirSync(dirname(configPath), { recursive: true });

    // Write with 2-space indent + trailing newline
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    return { toolName, configPath, action: existed ? 'updated' : 'created' };
  } catch (err) {
    return { toolName, configPath, action: 'error', error: String(err) };
  }
}

/**
 * Configure all detected tools in parallel.
 */
export async function configureAllTools(
  tools: Array<{ name: string; configPath: string }>,
  apiKey: string,
): Promise<ConfigureResult[]> {
  return Promise.all(tools.map((t) => configureToolMcp(t.configPath, apiKey, t.name)));
}

/**
 * Remove Celune MCP config from a tool's config file (for logout/cleanup).
 * Leaves other MCP servers untouched.
 */
export async function removeCeluneConfig(configPath: string): Promise<void> {
  if (!existsSync(configPath)) return;

  const raw = readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);

  if (config.mcpServers?.celune) {
    delete config.mcpServers.celune;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }
}
