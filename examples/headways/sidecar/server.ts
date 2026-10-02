/**
 * Celune sidecar for a Headways deployment: the self-host API with the
 * Headways harness registered for one workspace. A claim by a mapped agent
 * starts a Headways AgentRun; the run watcher reports its status back through
 * POST /v1/harness/events.
 *
 * Reads the self-host variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * CELUNE_HOST_JWT_SECRET, PORT, HOST) plus the HEADWAYS_* and CELUNE_* variables
 * listed in examples/headways/README.md.
 */
import { serve } from '@hono/node-server';
import { HarnessRegistry } from '@celuneai/core';
import {
  agentMapFromEnv,
  CeluneEventReporter,
  HEADWAYS_HARNESS_NAME,
  HeadwaysHarness,
  HeadwaysRunWatcher,
} from '@celuneai/harness-headways';
import { createClient } from '@supabase/supabase-js';
import { buildServer } from 'api/src/server.ts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[celune-sidecar] ${name} is required`);
    process.exit(1);
  }
  return value;
}

const port = Number(process.env.PORT ?? 3010);
// Loopback by default: this process holds the service role key and Headways keys.
const hostname = process.env.HOST?.trim() || '127.0.0.1';
const workspaceId = required('CELUNE_WORKSPACE_ID');
const orgId = process.env.CELUNE_ORG_ID?.trim() || null;
const jwtSecret = required('CELUNE_HOST_JWT_SECRET');
const agentMap = agentMapFromEnv(process.env);
const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const reporter = new CeluneEventReporter({
  apiUrl: process.env.CELUNE_SELF_URL?.trim() || `http://localhost:${port}`,
  workspaceId,
  orgId,
  subject: required('CELUNE_REPORTER_USER_ID'),
  jwt: { secret: jwtSecret },
});
const watcher = new HeadwaysRunWatcher({
  harness: HEADWAYS_HARNESS_NAME,
  reporter,
  onError: (error, runId) =>
    console.error(
      `[celune-sidecar] run ${runId}: ${error instanceof Error ? error.message : error}`,
    ),
});

const userKeys = Object.fromEntries(
  Object.entries(
    JSON.parse(process.env.HEADWAYS_USER_KEYS?.trim() || '{}') as Record<string, string>,
  ).map(([email, key]) => [email.toLowerCase(), key]),
);

const harness = new HeadwaysHarness({
  apiUrl: required('HEADWAYS_API_URL'),
  webUrl: process.env.HEADWAYS_WEB_URL?.trim(),
  orgSlug: required('HEADWAYS_ORG_SLUG'),
  apiKey: required('HEADWAYS_API_KEY'),
  userKeys,
  // A run is owned and billed as the Celune user who claimed or assigned the
  // task, through their own Headways key. Without one the run does not start:
  // an embed token's user is a Headways user id that resolves to no Celune
  // user here, and must never borrow the org owner's key.
  resolveOwnerEmail: async (_task, context) => {
    const userId = context.actor.userId;
    const { data } = userId
      ? await supabase.auth.admin.getUserById(userId)
      : { data: { user: null } };
    const email = data.user?.email?.toLowerCase();
    if (!email || !userKeys[email]) {
      throw new Error(
        'No Headways API key for the user who claimed this task. Add it to HEADWAYS_USER_KEYS.',
      );
    }
    return email;
  },
  profiles: agentMap.profiles,
  watcher,
});

const registry = new HarnessRegistry();
registry.register(workspaceId, harness, { agents: agentMap.agents });

const origins = (process.env.CELUNE_CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (origins.length === 0) {
  console.warn(
    '[celune-sidecar] CELUNE_CORS_ORIGINS is empty, so browsers cannot call this sidecar and the embed will fail.',
  );
}

const app = new Hono();
if (origins.length > 0) {
  app.use(
    '/v1/*',
    cors({
      origin: origins,
      allowHeaders: ['authorization', 'content-type', 'x-celune-workspace'],
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );
}
app.route('/', buildServer({ harnessRegistry: registry }));

watcher.start(Number(process.env.HEADWAYS_WATCH_INTERVAL_MS ?? 3000));
serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(
    `[celune-sidecar] listening on http://${hostname}:${info.port}, harness ${HEADWAYS_HARNESS_NAME}`,
  );
});
