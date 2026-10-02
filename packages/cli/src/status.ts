import { loadConfig } from './config-store.js';
import { getInstalledTools } from './detect.js';

export interface ConnectionStatus {
  authenticated: boolean;
  workspace: string | null;
  email: string | null;
  connectedTools: string[];
  apiReachable: boolean;
}

/**
 * Check connection status — auth, workspace, and configured tools.
 */
export async function getStatus(apiUrl: string): Promise<ConnectionStatus> {
  const config = loadConfig();

  if (!config) {
    return {
      authenticated: false,
      workspace: null,
      email: null,
      connectedTools: [],
      apiReachable: false,
    };
  }

  // Check API reachability
  let apiReachable = false;
  try {
    const res = await fetch(`${apiUrl}/api/mcp/health`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    apiReachable = res.ok;
  } catch {
    // unreachable
  }

  const installed = await getInstalledTools();

  return {
    authenticated: true,
    workspace: config.workspaceName,
    email: config.email,
    connectedTools: installed.map((t) => t.displayName),
    apiReachable,
  };
}
