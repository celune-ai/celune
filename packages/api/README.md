# @celuneai/api

HTTP handlers (Hono) and an MCP server on top of [`@celuneai/core`](https://www.npmjs.com/package/@celuneai/core). Mount it in any runtime Hono supports to serve Celune's REST API at `/v1` and MCP at `/v1/mcp`.

```bash
npm install @celuneai/api @celuneai/core hono
```

Exports include:

- `createApi(options)`: the Hono app with REST routes, auth, and permission checks
- `createMcpServer`, `handleMcpRequest`: the MCP server and its HTTP handler
- `createAuthenticator`, `mintHostJwt`, `verifyHostJwt`: API key and JWT authentication
- `claimJob`, `heartbeatJob`, `submitJobResult`: the job queue protocol used by IDE and CLI agents

For a complete server, see `apps/api` in the [Celune repository](https://github.com/celune-ai/celune): it wires `createApi` to Supabase with `@hono/node-server`.

Requires Node.js 20 or later.

## License

Apache-2.0
