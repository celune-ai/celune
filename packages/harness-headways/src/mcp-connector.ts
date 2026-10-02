import { mintServerToken, type ServerTokenOptions } from './tokens.ts';

/**
 * Connector row for the Headways catalog, in the shape of the vendor MCP
 * seeds in packages/db/prisma/seed/connectors.ts. The agent-runner mounts a
 * remote_mcp connector as `mcp__<key>`, so agents see the tools as `mcp__celune`.
 */
export interface CeluneMcpConnector {
  key: string;
  displayName: string;
  integrationType: 'remote_mcp';
  authType: 'api-key';
  configTemplate: { type: 'http'; url: string };
}

export function celuneMcpConnector(options: {
  /** Celune API origin; the MCP endpoint is /v1/mcp. */
  celuneApiUrl: string;
  key?: string;
  displayName?: string;
}): CeluneMcpConnector {
  return {
    key: options.key ?? 'celune',
    displayName: options.displayName ?? 'Celune',
    integrationType: 'remote_mcp',
    authType: 'api-key',
    configTemplate: { type: 'http', url: `${options.celuneApiUrl.replace(/\/$/, '')}/v1/mcp` },
  };
}

/**
 * Bearer the runner presents to the Celune MCP connector for one run. `sub` is
 * the Celune agent id that claimed the task, so a claim_task from inside the run
 * matches the active run and starts nothing new. No permissions claim, so /v1/mcp accepts it.
 */
export function mintAgentServerToken(
  input: { agentId: string; workspaceId: string; orgId?: string | null },
  options: ServerTokenOptions,
): Promise<string> {
  return mintServerToken(
    { sub: input.agentId, workspaceId: input.workspaceId, orgId: input.orgId ?? null },
    options,
  );
}
