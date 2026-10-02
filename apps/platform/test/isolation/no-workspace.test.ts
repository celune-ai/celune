/**
 * Permission checks that run without a workspace, on a real Supabase stack.
 *
 * Every account owns the org its signup created. Before the fix,
 * resolve_user_permissions(user, NULL) granted every permission to any org
 * owner, so every route that checked without a workspace was open to every
 * user. A is an ordinary org owner (never the platform owner). A must get 403 on
 * platform-wide routes, must not write into workspace B through a body
 * workspace_id, and must see and change only the invitations of org A.
 *
 * Only rate limiting and CSRF are replaced. Requests carry the x-user-id header
 * the middleware sets for a verified session.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rate-limiter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limiter')>()),
  applyRateLimit: vi.fn(async () => null),
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 1000,
    limit: 1000,
    resetAt: new Date(Date.now() + 60_000),
  })),
}));
vi.mock('@/lib/csrf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csrf')>()),
  validateOrigin: vi.fn(async () => null),
}));

import * as waitlist from '@/app/api/waitlist/route';
import * as inboxes from '@/app/api/agentmail/inboxes/route';
import { POST as agentmailSend } from '@/app/api/agentmail/send/route';
import { POST as agentmailReport } from '@/app/api/agentmail/report/route';
import { GET as healthMcps } from '@/app/api/health/mcps/route';
import { GET as vercel } from '@/app/api/analytics/vercel/route';
import { GET as elevenlabs } from '@/app/api/analytics/cost/elevenlabs/route';
import { GET as subscriptions } from '@/app/api/analytics/cost/subscriptions/route';
import { GET as credits } from '@/app/api/analytics/cost/credits/route';
import { POST as rollup } from '@/app/api/analytics/usage/rollup/route';
import { POST as costIngest } from '@/app/api/analytics/cost/ingest/route';
import { GET as platformUsers } from '@/app/api/users/platform/route';
import { POST as createWebhook } from '@/app/api/webhooks/endpoints/route';
import { POST as createTask } from '@/app/api/tasks/route';
import { PUT as orgPermissionOverride } from '@/app/api/org/permissions/route';
import { POST as inviteUser } from '@/app/api/user/invite/route';
import { POST as transferOwnership } from '@/app/api/org/transfer-ownership/route';
import { GET as listInvitations } from '@/app/api/invitations/route';
import * as invitation from '@/app/api/invitations/[id]/route';
import { POST as generateTask } from '@/app/api/tasks/generate/route';
import { POST as toggleAgent } from '@/app/api/agents/toggle/route';
import { POST as agentHeartbeat } from '@/app/api/agents/heartbeat/route';
import { POST as seedAgents } from '@/app/api/agents/seed/route';
import { POST as brainApplyUpdates } from '@/app/api/brain/apply-updates/route';
import { POST as brainMergePreview } from '@/app/api/brain/merge-preview/route';

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the isolation suite`);
  return value;
}

const RUN = randomUUID().slice(0, 8);
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(
  env('NEXT_PUBLIC_SUPABASE_URL'),
  env('SUPABASE_SERVICE_ROLE_KEY'),
  clientOptions,
);

interface Person {
  userId: string;
  email: string;
  orgId: string;
  workspaceId: string;
}

let A: Person;
let B: Person;
let C: Person;
let memberOfC: Person;
let invitedToA: { userId: string; email: string };
let invitedToB: { userId: string; email: string };
const created: string[] = [];

async function orgOf(userId: string) {
  const { data: org } = await admin
    .from('organizations')
    .select('id')
    .eq('owner_id', userId)
    .single();
  const { data: ws } = await admin
    .from('workspaces')
    .select('id')
    .eq('org_id', org!.id)
    .eq('is_default', true)
    .single();
  return { orgId: org!.id as string, workspaceId: ws!.id as string };
}

async function createPerson(label: string): Promise<Person> {
  const email = `no-workspace-${label}-${RUN}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: randomBytes(18).toString('base64url'),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  created.push(data.user.id);
  return { userId: data.user.id, email, ...(await orgOf(data.user.id)) };
}

async function roleId(slug: string): Promise<string> {
  const { data, error } = await admin
    .from('roles')
    .select('id')
    .eq('slug', slug)
    .eq('is_system', true)
    .is('org_id', null)
    .limit(1)
    .single();
  if (error || !data) throw new Error(`role ${slug}: ${error?.message}`);
  return data.id;
}

async function addMember(userId: string, orgId: string) {
  const { error } = await admin.from('org_members').insert({
    user_id: userId,
    org_id: orgId,
    role_id: await roleId('member'),
    is_owner: false,
    is_active: true,
  });
  if (error) throw new Error(`org_members: ${error.message}`);
}

/** A pending invitation into `org`, the way /api/user/invite leaves it. */
async function invite(label: string, org: Person) {
  const email = `no-workspace-invite-${label}-${RUN}@example.test`;
  const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email });
  if (error || !data.user) throw new Error(`invite ${label}: ${error?.message}`);
  created.push(data.user.id);
  await addMember(data.user.id, org.orgId);
  return { userId: data.user.id, email };
}

function req(method: string, path: string, body?: unknown, caller: Person = A): NextRequest {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-user-id': caller.userId,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Rows in B that the body-scoped routes could create. */
async function bRows() {
  const count = async (table: string, column: string, value: string) => {
    const { count: n, error } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, value);
    if (error) throw new Error(`${table}: ${error.message}`);
    return n;
  };
  return {
    webhooks: await count('webhook_endpoints', 'workspace_id', B.workspaceId),
    tasks: await count('tasks', 'workspace_id', B.workspaceId),
    overrides: await count('org_permission_overrides', 'org_id', B.orgId),
    members: await count('workspace_memberships', 'workspace_id', B.workspaceId),
    usage: await count('claude_usage', 'workspace_id', B.workspaceId),
  };
}

beforeAll(async () => {
  [A, B, C] = [await createPerson('a'), await createPerson('b'), await createPerson('c')];
  memberOfC = await createPerson('member-c');
  await addMember(memberOfC.userId, C.orgId);
  invitedToA = await invite('a', A);
  invitedToB = await invite('b', B);
});

afterAll(async () => {
  for (const userId of created) {
    await admin.from('organizations').delete().eq('owner_id', userId);
  }
  for (const userId of created) {
    await admin.auth.admin.deleteUser(userId);
  }
});

describe('resolve_user_permissions without a workspace', () => {
  it('grants an org owner nothing', async () => {
    const { data, error } = await admin.rpc('resolve_user_permissions', {
      p_user_id: A.userId,
      p_workspace_id: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ is_platform_owner: false, is_owner: false, permission_keys: [] });
  });

  it('resolves org permissions only inside the org', async () => {
    const own = await admin.rpc('resolve_user_org_permissions', {
      p_user_id: A.userId,
      p_org_id: A.orgId,
    });
    expect(own.error).toBeNull();
    expect(own.data).toMatchObject({ is_owner: true, is_platform_owner: false });
    expect((own.data as { permission_keys: string[] }).permission_keys).toContain('users:manage');

    const other = await admin.rpc('resolve_user_org_permissions', {
      p_user_id: A.userId,
      p_org_id: B.orgId,
    });
    expect(other.error).toBeNull();
    expect(other.data).toMatchObject({ is_owner: false, permission_keys: [] });
  });
});

describe('platform-wide routes', () => {
  it('refuses an org owner, with or without a workspace_id', async () => {
    const ws = `?workspace_id=${A.workspaceId}`;
    const calls: [string, Promise<Response>][] = [
      ['waitlist GET', waitlist.GET(req('GET', '/api/waitlist'))],
      [
        'waitlist PATCH',
        waitlist.PATCH(req('PATCH', `/api/waitlist${ws}`, { id: randomUUID(), status: 'invited' })),
      ],
      ['agentmail inboxes GET', inboxes.GET(req('GET', '/api/agentmail/inboxes'))],
      [
        'agentmail inboxes POST',
        inboxes.POST(req('POST', '/api/agentmail/inboxes', { workspace_id: A.workspaceId })),
      ],
      [
        'agentmail send',
        agentmailSend(
          req('POST', '/api/agentmail/send', {
            agent_id: 'rick',
            to: 'x@example.test',
            subject: 's',
            text: 't',
          }),
        ),
      ],
      [
        'agentmail report',
        agentmailReport(
          req('POST', '/api/agentmail/report', {
            from_agent: 'rick',
            to: 'x@example.test',
            subject: 's',
            markdown: 't',
          }),
        ),
      ],
      ['health mcps', healthMcps(req('GET', '/api/health/mcps'))],
      ['analytics vercel', vercel(req('GET', '/api/analytics/vercel'))],
      ['cost elevenlabs', elevenlabs(req('GET', '/api/analytics/cost/elevenlabs'))],
      ['cost subscriptions', subscriptions(req('GET', '/api/analytics/cost/subscriptions'))],
      ['cost credits', credits(req('GET', '/api/analytics/cost/credits'))],
      ['usage rollup', rollup(req('POST', `/api/analytics/usage/rollup${ws}`, {}))],
      ['users platform', platformUsers(req('GET', '/api/users/platform'))],
    ];
    for (const [name, call] of calls) {
      expect((await call).status, name).toBe(403);
    }
  });
});

describe('body workspace_id', () => {
  it('checks the permission on the body workspace and writes nothing into B', async () => {
    const before = await bRows();
    const calls: [string, Promise<Response>][] = [
      [
        'webhook',
        createWebhook(
          req('POST', '/api/webhooks/endpoints', {
            workspace_id: B.workspaceId,
            url: 'https://example.test/hook',
            events: ['task.completed'],
          }),
        ),
      ],
      [
        'task',
        createTask(req('POST', '/api/tasks', { workspace_id: B.workspaceId, title: `T ${RUN}` })),
      ],
      [
        'org permission override',
        orgPermissionOverride(
          req('PUT', '/api/org/permissions', {
            workspace_id: B.workspaceId,
            role_slug: 'member',
            permission_key: 'tasks:read',
            enabled: false,
          }),
        ),
      ],
      [
        'invite',
        inviteUser(
          req('POST', '/api/user/invite', {
            email: `no-workspace-into-b-${RUN}@example.test`,
            role: 'member',
            workspace_id: B.workspaceId,
          }),
        ),
      ],
      [
        'cost ingest',
        costIngest(
          req('POST', '/api/analytics/cost/ingest', {
            session_id: RUN,
            model: 'm',
            input_tokens: 1,
            output_tokens: 1,
            total_cost_usd: 0,
            workspace_id: B.workspaceId,
          }),
        ),
      ],
      [
        'task generation',
        generateTask(
          req('POST', '/api/tasks/generate', { workspace_id: B.workspaceId, prompt: 'x' }),
        ),
      ],
      [
        'agent toggle',
        toggleAgent(
          req('POST', '/api/agents/toggle', {
            workspace_id: B.workspaceId,
            agent_id: 'rick',
            is_active: false,
          }),
        ),
      ],
      [
        'agent heartbeat',
        agentHeartbeat(
          req('POST', '/api/agents/heartbeat', {
            workspace_id: B.workspaceId,
            agent_id: 'rick',
            status: 'online',
          }),
        ),
      ],
      ['agent seed', seedAgents(req('POST', '/api/agents/seed', { workspace_id: B.workspaceId }))],
      [
        'brain apply updates',
        brainApplyUpdates(req('POST', '/api/brain/apply-updates', { workspace_id: B.workspaceId })),
      ],
      [
        'brain merge preview',
        brainMergePreview(
          req('POST', '/api/brain/merge-preview', { workspace_id: B.workspaceId, path: 'x.md' }),
        ),
      ],
    ];
    for (const [name, call] of calls) {
      expect((await call).status, name).toBe(403);
    }
    expect(await bRows()).toEqual(before);
  });

  it('refuses a body workspace_id that differs from the query', async () => {
    const res = await createWebhook(
      req('POST', `/api/webhooks/endpoints?workspace_id=${A.workspaceId}`, {
        workspace_id: B.workspaceId,
        url: 'https://example.test/hook',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('invitations', () => {
  it('lists only invitations into the caller org', async () => {
    const res = await listInvitations(req('GET', '/api/invitations'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(invitedToA.email);
    expect(text).not.toContain(invitedToB.email);
  });

  it('answers 404 for an invitation into another org and keeps it', async () => {
    const resend = await invitation.PUT(
      req('PUT', `/api/invitations/${invitedToB.userId}`),
      params(invitedToB.userId),
    );
    expect(resend.status).toBe(404);
    const revoke = await invitation.DELETE(
      req('DELETE', `/api/invitations/${invitedToB.userId}`),
      params(invitedToB.userId),
    );
    expect(revoke.status).toBe(404);
    const { data } = await admin.auth.admin.getUserById(invitedToB.userId);
    expect(data.user).not.toBeNull();
    const { data: member } = await admin
      .from('org_members')
      .select('id')
      .eq('user_id', invitedToB.userId)
      .eq('org_id', B.orgId)
      .maybeSingle();
    expect(member).not.toBeNull();
  });

  it('revokes an invitation into the caller org', async () => {
    const res = await invitation.DELETE(
      req('DELETE', `/api/invitations/${invitedToA.userId}`),
      params(invitedToA.userId),
    );
    expect(res.status).toBe(200);
    const { data } = await admin.auth.admin.getUserById(invitedToA.userId);
    expect(data.user ?? null).toBeNull();
  });
});

describe('org ownership transfer', () => {
  it('still lets an org owner hand the org to a member', async () => {
    const res = await transferOwnership(
      req('POST', '/api/org/transfer-ownership', { target_user_id: memberOfC.userId }, C),
    );
    expect(res.status).toBe(200);
    const { data } = await admin
      .from('org_members')
      .select('user_id, is_owner')
      .eq('org_id', C.orgId)
      .eq('is_owner', true);
    expect(data).toEqual([{ user_id: memberOfC.userId, is_owner: true }]);
  });
});
