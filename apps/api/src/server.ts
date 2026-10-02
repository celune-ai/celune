/**
 * Standalone Celune API for self-host. Reads its configuration from the
 * environment, serves the REST handlers under /v1, MCP at /v1/mcp, and
 * /health at the root.
 */
import { serve } from '@hono/node-server';
import { createApi, createAuthenticator, jwtConfigFromEnv } from '@celuneai/api';
import { createServices, resolveHostConfig, type HarnessRegistry } from '@celuneai/core';
import { SupabaseAttachmentBlobs, SupabaseStore } from '@celuneai/core/supabase';
import { createClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { createApiKeyLookup, createHost } from './host.ts';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[celune-api] ${name} is required`);
    process.exit(1);
  }
  return value;
}

export interface BuildServerOptions {
  /** Harness adapters by workspace; hosts that run tasks on their own agent runtime pass one. */
  harnessRegistry?: HarnessRegistry;
}

export function buildServer(options: BuildServerOptions = {}) {
  const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const hostConfig = resolveHostConfig(process.env);
  // Community edition runs the NoopGate; plan gating belongs to the cloud host.
  const services = createServices(new SupabaseStore(supabase), {
    attachmentBlobs: new SupabaseAttachmentBlobs(supabase),
    harnessRegistry: options.harnessRegistry,
  });
  const api = createApi({
    services,
    authenticate: createAuthenticator({
      apiKeyPrefix: hostConfig.apiKeyPrefix,
      apiKeys: createApiKeyLookup(supabase),
      jwt: jwtConfigFromEnv(process.env),
    }),
    host: createHost(supabase, process.env),
    basePath: '/v1',
    mcp: { serverInfo: { name: hostConfig.productName.toLowerCase(), version: '1.0.0' } },
  });

  const app = new Hono();
  app.get('/health', (c) =>
    c.json({ ok: true, service: 'celune-api', edition: hostConfig.edition }),
  );
  app.route('/', api);
  return app;
}

const isEntry = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isEntry) {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 3010);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[celune-api] listening on http://localhost:${info.port}`);
  });
}
