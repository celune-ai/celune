/**
 * GET /api/workspaces/plan reports the org owner (the payer) as is_workspace_owner.
 * A workspace-level owner who does not own the org must not see checkout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/plan-enforcement', () => ({
  resolveWorkspacePlan: vi.fn(async () => ({
    plan: 'unpaid',
    limits: { features: [] },
    isPlatformOwner: false,
  })),
}));

let orgOwnerId = 'org-owner';

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const data =
        table === 'workspaces'
          ? { org_id: 'org-1' }
          : table === 'organizations'
            ? { owner_id: orgOwnerId }
            : // A workspace membership with the owner role must not make the caller the payer.
              { role: 'owner' };
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.single = vi.fn(async () => ({ data, error: null }));
      q.maybeSingle = vi.fn(async () => ({ data, error: null }));
      return q;
    },
  }),
}));

import { GET } from '../workspaces/plan/route';

function get(userId: string) {
  return GET(
    new NextRequest(
      new URL(
        'http://localhost:3002/api/workspaces/plan?workspace_id=11111111-1111-4111-8111-111111111111',
      ),
      {
        headers: { 'x-user-id': userId },
      } as never,
    ),
  );
}

beforeEach(() => {
  orgOwnerId = 'org-owner';
});

describe('GET /api/workspaces/plan', () => {
  it('marks the org owner as the payer', async () => {
    const body = await (await get('org-owner')).json();
    expect(body.is_workspace_owner).toBe(true);
    expect(body.plan).toBe('unpaid');
  });

  it('does not mark a workspace owner who does not own the org', async () => {
    const body = await (await get('workspace-owner')).json();
    expect(body.is_workspace_owner).toBe(false);
  });
});
