import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  openSync,
  closeSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** Default directory for storing Celune CLI config and credentials. */
export const CONFIG_DIR = join(homedir(), '.celune');

/** Path to the main config file. */
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/** Path to the stored credentials file (legacy alias). */
export const CREDENTIALS_PATH = CONFIG_FILE;

export interface CeluneConfig {
  apiKey: string;
  workspaceId: string;
  workspaceName: string;
  userId: string;
  email: string;
  mcpEndpoint: string;
  installedAt: string;
}

/**
 * Read stored config from disk.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function loadConfig(): CeluneConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    if (typeof config?.apiKey !== 'string' || !config?.workspaceId) {
      return null;
    }
    return config as CeluneConfig;
  } catch {
    return null;
  }
}

/**
 * Write config to disk with owner-only permissions (chmod 600).
 */
export function saveConfig(config: CeluneConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  // Write with owner-only permissions from the start to avoid race condition
  const fd = openSync(CONFIG_FILE, 'w', 0o600);
  writeFileSync(fd, JSON.stringify(config, null, 2) + '\n');
  closeSync(fd);
}

/**
 * Delete stored config file.
 */
export function deleteConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE);
  }
}

// ---- Legacy aliases for backward-compat ----

export interface StoredCredentials {
  token: string;
  expiresAt: number;
  workspaceId: string;
}

/**
 * Read stored credentials from disk.
 * @deprecated Use loadConfig() instead.
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  const config = loadConfig();
  if (!config) return null;
  return {
    token: config.apiKey,
    expiresAt: 0, // API keys don't expire by default
    workspaceId: config.workspaceId,
  };
}

/**
 * Write credentials to disk.
 * @deprecated Use saveConfig() instead.
 */
export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  const existing = loadConfig();
  saveConfig({
    apiKey: credentials.token,
    workspaceId: credentials.workspaceId,
    workspaceName: existing?.workspaceName ?? '',
    userId: existing?.userId ?? '',
    email: existing?.email ?? '',
    mcpEndpoint: existing?.mcpEndpoint ?? '',
    installedAt: existing?.installedAt ?? new Date().toISOString(),
  });
}

/**
 * Delete stored credentials.
 */
export async function clearCredentials(): Promise<void> {
  deleteConfig();
}
