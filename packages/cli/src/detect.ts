import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

export interface DetectedTool {
  name: 'claude-code' | 'cursor' | 'windsurf' | 'cline';
  displayName: string;
  configPath: string;
  installed: boolean;
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan the system for known AI coding tools and their config locations.
 */
export async function detectTools(): Promise<DetectedTool[]> {
  const home = homedir();

  return [
    {
      name: 'claude-code',
      displayName: 'Claude Code',
      configPath: join(home, '.claude.json'),
      installed: existsSync(join(home, '.claude.json')) || commandExists('claude'),
    },
    {
      name: 'cursor',
      displayName: 'Cursor',
      configPath: join(home, '.cursor', 'mcp.json'),
      installed: existsSync(join(home, '.cursor')) || commandExists('cursor'),
    },
    {
      name: 'windsurf',
      displayName: 'Windsurf',
      configPath: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      installed: existsSync(join(home, '.codeium')),
    },
    {
      name: 'cline',
      displayName: 'Cline (VS Code)',
      configPath: join(process.cwd(), '.vscode', 'cline_mcp_settings.json'),
      installed: commandExists('code'),
    },
  ];
}

/**
 * Return only the tools that are currently installed.
 */
export async function getInstalledTools(): Promise<DetectedTool[]> {
  const tools = await detectTools();
  return tools.filter((t) => t.installed);
}
