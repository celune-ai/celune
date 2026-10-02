/** Host defaults for the CLI. CELUNE_API_URL points a self-hosted install at its own server. */
export const DEFAULT_API_URL = (process.env.CELUNE_API_URL || 'https://app.celune.ai').replace(
  /\/+$/,
  '',
);
export const DEFAULT_MCP_URL = `${DEFAULT_API_URL}/api/mcp`;
