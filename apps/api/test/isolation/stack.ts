/**
 * Setup for the real-Supabase isolation suite: clients for the booted stack,
 * two self-signup tenants (the new-user trigger gives each its own org and
 * default workspace), API keys and host JWTs for each, and request helpers
 * for the standalone v1 server.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EMBED_PERMISSION_KEYS, mintHostJwt } from '@celuneai/api';
import { createScope, resolveHostConfig, type WorkspaceScope } from '@celuneai/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const RUN = randomUUID().slice(0, 8);

export function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the isolation suite`);
  return value;
}

export const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const JWT_SECRET = env('CELUNE_HOST_JWT_SECRET');

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client, for seeding and for checking rows after an attack. */
export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, clientOptions);

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, clientOptions);
}

export interface Tenant {
  label: string;
  userId: string;
  email: string;
  password: string;
  workspaceId: string;
  orgId: string;
  scope: WorkspaceScope;
  /** API key with read, write, and admin scopes. */
  adminKey: string;
  /** Host JWT without a permissions claim, as a host's server mints it. */
  serverJwt: string;
  /** Host JWT with every task and project key, as the embed token route mints it. */
  embedJwt: string;
}

async function insertKey(
  workspaceId: string,
  orgId: string,
  userId: string,
  scopes: string[],
): Promise<string> {
  const prefix = resolveHostConfig(process.env).apiKeyPrefix;
  const raw = `${prefix}_live_${randomBytes(24).toString('hex')}`;
  const { error } = await admin.from('api_keys').insert({
    workspace_id: workspaceId,
    org_id: orgId,
    user_id: userId,
    name: `isolation ${RUN}`,
    key_hash: createHash('sha256').update(raw).digest('hex'),
    key_prefix: raw.slice(0, prefix.length + 8),
    environment: 'live',
    scopes,
  });
  if (error) throw new Error(`api_keys insert: ${error.message}`);
  return raw;
}

function jwtOptions() {
  return {
    secret: JWT_SECRET,
    issuer: process.env.CELUNE_HOST_JWT_ISSUER?.trim() || undefined,
    audience: process.env.CELUNE_HOST_JWT_AUDIENCE?.trim() || undefined,
  };
}

export async function createTenant(label: string): Promise<Tenant> {
  const email = `isolation-${label}-${RUN}@example.test`;
  const password = randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  const userId = data.user.id;

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select('id')
    .eq('owner_id', userId)
    .single();
  if (orgError || !org) throw new Error(`no org for ${label}: ${orgError?.message}`);
  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .select('id')
    .eq('org_id', org.id)
    .eq('is_default', true)
    .single();
  if (wsError || !workspace) throw new Error(`no workspace for ${label}: ${wsError?.message}`);

  const claims = { sub: userId, workspace_id: workspace.id, org_id: org.id };
  return {
    label,
    userId,
    email,
    password,
    workspaceId: workspace.id,
    orgId: org.id,
    scope: createScope({ workspaceId: workspace.id, orgId: org.id, actorId: userId }),
    adminKey: await insertKey(workspace.id, org.id, userId, ['read', 'write', 'admin']),
    serverJwt: await mintHostJwt({ ...claims, scopes: ['write'] }, jwtOptions()),
    embedJwt: await mintHostJwt(
      { ...claims, scopes: ['write'], permissions: [...EMBED_PERMISSION_KEYS] },
      jwtOptions(),
    ),
  };
}

export async function signedInClient(tenant: Tenant): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: tenant.email,
    password: tenant.password,
  });
  if (error) throw new Error(`sign in ${tenant.label}: ${error.message}`);
  return client;
}

export interface Reply {
  status: number;
  // Response bodies are asserted field by field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export type Fetcher = (request: Request) => Response | Promise<Response>;

export function requester(fetcher: Fetcher, basePath: string) {
  return async function call(
    token: string | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Reply> {
    const headers: Record<string, string> = { accept: 'application/json, text/event-stream' };
    if (token) headers.authorization = `Bearer ${token}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const res = await fetcher(
      new Request(`http://isolation.test${basePath}${path}`, { method, headers, body: payload }),
    );
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };
}

/** Parses a JSON-RPC reply sent as JSON or as one SSE event. */
export function rpcReply(reply: Reply): { result?: any; error?: { message: string } } {
  if (typeof reply.json !== 'string') return reply.json ?? {};
  const line = reply.json.split('\n').find((l: string) => l.startsWith('data: '));
  return line ? JSON.parse(line.slice(6)) : {};
}

/** Deletes the tenant's users; ON DELETE CASCADE on the org removes the rest. */
export async function dropTenant(tenant: Tenant | undefined): Promise<void> {
  if (!tenant) return;
  await admin.from('organizations').delete().eq('id', tenant.orgId);
  await admin.auth.admin.deleteUser(tenant.userId);
}
