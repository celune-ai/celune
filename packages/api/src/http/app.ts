import { createScope, type Services } from '@celuneai/core';
import { Hono } from 'hono';
import type { Authenticator } from '../auth/authenticate.ts';
import { hasScope, isEmbedToken, type AuthContext } from '../auth/types.ts';
import { resolveWorkspaceFor, type ApiHost } from '../host.ts';
import type { McpServerOptions } from '../mcp/server.ts';
import type { McpToolHandler, ToolContext } from '../mcp/types.ts';
import type { ApiEnv } from './env.ts';
import { errorToResponse, REQUEST_ID_HEADER, requestIdFor } from './errors.ts';
import { embedWritePermission, requireReadPermission } from './permissions.ts';
import { activity } from './routes/activity.ts';
import { agents } from './routes/agents.ts';
import { executions } from './routes/executions.ts';
import { harness, harnessEventAccessError } from './routes/harness.ts';
import { jobs } from './routes/jobs.ts';
import { mcp } from './routes/mcp.ts';
import { projects } from './routes/projects.ts';
import { tasks } from './routes/tasks.ts';

export interface ApiOptions {
  /** One bundle for the host, or a factory when services depend on the caller. */
  services: Services | ((auth: AuthContext) => Services);
  authenticate: Authenticator;
  host?: ApiHost;
  /** Mount prefix, such as `/api/v1` inside Next.js or `/v1` standalone. */
  basePath?: string;
  mcp?: {
    instructions?: (auth: AuthContext) => Promise<string | undefined> | string | undefined;
    /** Host tools; one with the name of a package tool replaces it. */
    extraTools?: McpToolHandler[];
    /** Adds host-only values (a database client, say) to the context host tools receive. */
    extendContext?: (ctx: ToolContext) => ToolContext;
    serverInfo?: McpServerOptions['serverInfo'];
    /** Answer JSON instead of an SSE stream; handy for tests and simple clients. */
    enableJsonResponse?: boolean;
  };
}

export const HEALTH_PATH = '/health';
export const MCP_PATH = '/mcp';

export function createApi(options: ApiOptions): Hono<ApiEnv> {
  const base = new Hono<ApiEnv>();
  const app = options.basePath ? base.basePath(options.basePath) : base;
  const host = options.host ?? {};
  const prefix = (options.basePath ?? '').replace(/\/+$/, '');
  const healthPath = `${prefix}${HEALTH_PATH}`;
  const mcpPath = `${prefix}${MCP_PATH}`;

  // Runs first so every response carries a request id. Hono only hands Error
  // instances to onError; the catch here maps anything else a route throws.
  app.use('*', async (c, next) => {
    const requestId = requestIdFor(c.req.header(REQUEST_ID_HEADER));
    c.set('requestId', requestId);
    try {
      await next();
    } catch (error) {
      c.res = errorToResponse(c, error);
    }
    c.header(REQUEST_ID_HEADER, requestId);
  });

  app.get(HEALTH_PATH, (c) => c.json({ ok: true, service: 'celune-api' }));

  app.use('*', async (c, next) => {
    if (c.req.path === healthPath) return next();
    const result = await options.authenticate(c.req.raw);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status, result.headers);
    }
    const { auth } = result;
    // MCP filters tools by scope itself, so a read-only key may still POST to it.
    const needed = c.req.method === 'GET' || c.req.method === 'HEAD' ? 'read' : 'write';
    if (c.req.path !== mcpPath && !hasScope(auth, needed)) {
      return c.json({ error: `Insufficient scope. Required: ${needed}` }, 403);
    }
    // An embed token's write scope covers only the operations its keys name.
    if (needed === 'write' && c.req.path !== mcpPath && isEmbedToken(auth)) {
      const route = c.req.path.slice(prefix.length);
      const key = embedWritePermission(c.req.method, route);
      if (!key) {
        const error = route.startsWith('/harness/events')
          ? harnessEventAccessError(auth)
          : 'Embed tokens cannot call this route';
        return c.json({ error }, 403);
      }
      if (!auth.permissions?.includes(key)) {
        return c.json({ error: 'Forbidden', required: key }, 403);
      }
    }
    const resolved = await resolveWorkspaceFor(host, auth, c.req.query('workspace_id'));
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);

    const services =
      typeof options.services === 'function' ? options.services(auth) : options.services;
    const scope = createScope({
      workspaceId: resolved.workspaceId,
      orgId: resolved.orgId,
      actorId: auth.userId,
    });
    // Every call, reads and MCP included, needs the workspace to be usable (a hosted paywall, say).
    const access = await services.gate.check('workspace.access', { scope, userId: auth.userId });
    if (!access.allowed) {
      return c.json(access.details ?? { error: access.reason }, access.status ?? 403);
    }

    c.set('auth', auth);
    c.set('host', host);
    c.set('services', services);
    c.set('scope', scope);
    c.set('actor', { source: 'api', userId: auth.userId });
    return next();
  });

  // Host JWTs with a permissions claim need the matching read key, as writes do.
  const reads: Array<[string, Parameters<typeof requireReadPermission>[0]]> = [
    ['/tasks', 'tasks:read'],
    ['/projects', 'projects:read'],
    // One task's history is task data; the workspace-wide feed is analytics, as on the platform.
    ['/activity', (c) => (c.req.query('task_id') ? 'tasks:read' : 'analytics:read')],
    ['/agents', 'agents:read'],
    ['/jobs', 'tasks:read'],
    ['/executions', 'tasks:read'],
  ];
  for (const [path, key] of reads) {
    app.use(path, requireReadPermission(key));
    app.use(`${path}/*`, requireReadPermission(key));
  }

  app.route('/tasks', tasks);
  app.route('/projects', projects);
  app.route('/activity', activity);
  app.route('/agents', agents);
  app.route('/jobs', jobs);
  app.route('/executions', executions);
  app.route('/harness', harness);
  app.route(
    MCP_PATH,
    mcp({
      instructions: options.mcp?.instructions,
      extraTools: options.mcp?.extraTools,
      extendContext: options.mcp?.extendContext,
      serverInfo: options.mcp?.serverInfo,
      enableJsonResponse: options.mcp?.enableJsonResponse,
    }),
  );

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((error, c) => errorToResponse(c, error));
  return app;
}
