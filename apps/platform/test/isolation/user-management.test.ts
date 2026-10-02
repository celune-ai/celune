/**
 * The /api/users/[id] routes on a real Supabase stack. Org A's owner and admin
 * may act on a user only through org A: users of org B answer 404 and stay
 * unchanged, and for a user who also belongs to org B or owns the org their
 * signup created, only the org A membership changes. The account, its sessions,
 * and its other orgs are untouched.
 *
 * Only rate limiting, CSRF, and the cookie session factory are replaced. Requests
 * carry the x-user-id header the middleware sets for a verified session.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@repo/db/server', () => ({ createClient: async () => session.client }));
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

import { DELETE as deleteUser } from '@/app/api/users/[id]/route';
import { PUT as putRole } from '@/app/api/users/[id]/role/route';
import { PUT as putStatus } from '@/app/api/users/[id]/status/route';

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the isolation suite`);
  return value;
}

const RUN = randomUUID().slice(0, 8);
const URL_ = env('NEXT_PUBLIC_SUPABASE_URL');
const ANON = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, env('SUPABASE_SERVICE_ROLE_KEY'), clientOptions);

interface Person {
  userId: string;
  email: string;
  password: string;
  orgId: string;
}

let A: Person;
let B: Person;
let memberOfA: Person;
let memberOfB: Person;
let inBoth: Person;
let invitedToA: Person;
let adminOfA: Person;
const created: string[] = [];

async function createPerson(label: string): Promise<Person> {
  const email = `users-isolation-${label}-${RUN}@example.test`;
  const password = randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  created.push(data.user.id);
  const { data: org } = await admin
    .from('organizations')
    .select('id')
    .eq('owner_id', data.user.id)
    .single();
  return { userId: data.user.id, email, password, orgId: org!.id };
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

/** A signed-up user moved out of their own org and into `orgs` as a plain member. */
async function createMember(label: string, orgs: Person[]): Promise<Person> {
  const person = await createPerson(label);
  await admin.from('org_members').delete().eq('user_id', person.userId);
  await admin.from('org_memberships').delete().eq('user_id', person.userId);
  const member = await roleId('member');
  for (const org of orgs) {
    const { error } = await admin.from('org_members').insert({
      user_id: person.userId,
      org_id: org.orgId,
      role_id: member,
      is_owner: false,
      is_active: true,
    });
    if (error) throw new Error(`org_members ${label}: ${error.message}`);
    await admin
      .from('org_memberships')
      .insert({ user_id: person.userId, org_id: org.orgId, role: 'member' });
  }
  return { ...person, orgId: orgs[0]!.orgId };
}

/** A signed-up user who keeps their own org and also joins `org` with `role`. */
async function joinOrg(label: string, org: Person, role: string): Promise<Person> {
  const person = await createPerson(label);
  const { error } = await admin.from('org_members').insert({
    user_id: person.userId,
    org_id: org.orgId,
    role_id: await roleId(role),
    is_owner: false,
    is_active: true,
  });
  if (error) throw new Error(`org_members ${label}: ${error.message}`);
  return person;
}

async function signIn(person: Person): Promise<SupabaseClient> {
  const client = createClient(URL_, ANON, clientOptions);
  const { error } = await client.auth.signInWithPassword({
    email: person.email,
    password: person.password,
  });
  if (error) throw new Error(`sign in: ${error.message}`);
  return client;
}

function req(method: string, path: string, body?: unknown, caller: Person = A): NextRequest {
  // The middleware sets x-user-id after it verifies the session cookie.
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

/** Everything these routes can change about a user. */
async function state(userId: string) {
  const { data: auth } = await admin.auth.admin.getUserById(userId);
  const { data: roles } = await admin
    .from('user_roles')
    .select('role, is_active')
    .eq('user_id', userId);
  const { data: members } = await admin
    .from('org_members')
    .select('org_id, role_id, is_owner, is_active')
    .eq('user_id', userId)
    .order('org_id');
  return {
    exists: Boolean(auth?.user),
    bannedUntil: (auth?.user as { banned_until?: string | null } | undefined)?.banned_until ?? null,
    roles,
    members,
  };
}

beforeAll(async () => {
  [A, B] = [await createPerson('a'), await createPerson('b')];
  memberOfA = await createMember('member-a', [A]);
  memberOfB = await createMember('member-b', [B]);
  inBoth = await createMember('both', [A, B]);
  invitedToA = await joinOrg('invited-a', A, 'member');
  adminOfA = await joinOrg('admin-a', A, 'admin');
  session.client = await signIn(A);
});

afterAll(async () => {
  for (const userId of created) {
    await admin.from('organizations').delete().eq('owner_id', userId);
  }
  for (const userId of created) {
    await admin.auth.admin.deleteUser(userId);
  }
});

async function membership(userId: string, orgId: string) {
  const { data } = await admin
    .from('org_members')
    .select('org_id, role_id, is_owner, is_active')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle();
  return data;
}

/** state() without the org A membership, which is the only thing allowed to change. */
async function outsideA(userId: string) {
  const all = await state(userId);
  return { ...all, members: (all.members ?? []).filter((m) => m.org_id !== A.orgId) };
}

describe('user management across orgs', () => {
  it('answers 404 and changes nothing for users of another org', async () => {
    for (const target of [memberOfB, B]) {
      const before = await state(target.userId);
      const calls = [
        deleteUser(req('DELETE', `/api/users/${target.userId}`), params(target.userId)),
        putRole(
          req('PUT', `/api/users/${target.userId}/role`, { role: 'viewer' }),
          params(target.userId),
        ),
        putStatus(
          req('PUT', `/api/users/${target.userId}/status`, { is_active: false }),
          params(target.userId),
        ),
      ];
      for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
      expect(await state(target.userId)).toEqual(before);
    }
  });

  it('changes the role only in org A for a user who owns their own org', async () => {
    const before = await outsideA(invitedToA.userId);
    const res = await putRole(
      req('PUT', `/api/users/${invitedToA.userId}/role`, { role: 'viewer' }),
      params(invitedToA.userId),
    );
    expect(res.status).toBe(200);
    expect((await membership(invitedToA.userId, A.orgId))?.role_id).toBe(await roleId('viewer'));
    expect(await outsideA(invitedToA.userId)).toEqual(before);
  });

  it('deactivates only the org A membership, without banning the account', async () => {
    const before = await outsideA(invitedToA.userId);
    const res = await putStatus(
      req('PUT', `/api/users/${invitedToA.userId}/status`, { is_active: false }),
      params(invitedToA.userId),
    );
    expect(res.status).toBe(200);
    expect((await membership(invitedToA.userId, A.orgId))?.is_active).toBe(false);
    expect(await outsideA(invitedToA.userId)).toEqual(before);
  });

  it('removes a user in both orgs from org A only', async () => {
    const before = await outsideA(inBoth.userId);
    const res = await deleteUser(
      req('DELETE', `/api/users/${inBoth.userId}`),
      params(inBoth.userId),
    );
    expect(res.status).toBe(200);
    expect(await membership(inBoth.userId, A.orgId)).toBeNull();
    expect(await outsideA(inBoth.userId)).toEqual(before);
  });

  it('refuses an org admin without users:manage and leaves the member and owner unchanged', async () => {
    for (const target of [memberOfA, A]) {
      const before = await state(target.userId);
      const role = await putRole(
        req('PUT', `/api/users/${target.userId}/role`, { role: 'viewer' }, adminOfA),
        params(target.userId),
      );
      expect(role.status).toBe(403);
      const status = await putStatus(
        req('PUT', `/api/users/${target.userId}/status`, { is_active: false }, adminOfA),
        params(target.userId),
      );
      expect(status.status).toBe(403);
      expect(await state(target.userId)).toEqual(before);
    }
  });
});
