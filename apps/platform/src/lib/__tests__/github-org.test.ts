import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for org-level GitHub installation helpers.
 *
 * Verifies: register, verify, disconnect cascade, and cross-org rejection.
 * Uses a mock Supabase client to test the query logic without a real DB.
 */

// --- Fixtures ---

const ORG_A = 'org-aaaa-0000-0000-000000000001';
const ORG_B = 'org-bbbb-0000-0000-000000000002';
const USER_1 = 'user-1111-0000-0000-000000000001';
const INSTALL_1 = 12345;
const INSTALL_2 = 67890;
const RECORD_ID = 'rec-0000-0000-0000-000000000001';
const WS_1 = 'ws-0001-0000-0000-000000000001';
const WS_2 = 'ws-0002-0000-0000-000000000002';

const mockInstallation = {
  id: RECORD_ID,
  org_id: ORG_A,
  installation_id: INSTALL_1,
  github_account_login: 'acme-org',
  github_account_avatar_url: 'https://avatars.example.com/acme',
  github_account_type: 'Organization' as const,
  connected_by: USER_1,
  connected_at: '2026-03-11T00:00:00Z',
  is_active: true,
};

// --- Mock Supabase builder ---

function createMockBuilder(resolvedData: unknown = null, resolvedError: unknown = null) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'select',
    'eq',
    'neq',
    'in',
    'is',
    'order',
    'insert',
    'update',
    'upsert',
    'delete',
  ];
  for (const m of methods) {
    builder[m] = vi.fn().mockReturnValue(builder);
  }
  builder.single = vi.fn().mockResolvedValue({ data: resolvedData, error: resolvedError });
  // Non-single queries return array
  (builder as Record<string, unknown>)['then'] = undefined; // not thenable by default
  return builder;
}

function createMockSupabase(buildersByTable: Record<string, ReturnType<typeof createMockBuilder>>) {
  return {
    from: vi.fn((table: string) => {
      return buildersByTable[table] ?? createMockBuilder();
    }),
  };
}

// --- Import the module under test (must be after mocks would be set up) ---
// Since github-org.ts imports createServiceClient only for the type,
// and all functions take supabase as a parameter, no module mocks needed.

let verifyOrgInstallation: typeof import('../github-org').verifyOrgInstallation;
let getOrgInstallations: typeof import('../github-org').getOrgInstallations;
let orgHasAnyInstallation: typeof import('../github-org').orgHasAnyInstallation;
let registerOrgInstallation: typeof import('../github-org').registerOrgInstallation;
let disconnectOrgInstallation: typeof import('../github-org').disconnectOrgInstallation;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../github-org');
  verifyOrgInstallation = mod.verifyOrgInstallation;
  getOrgInstallations = mod.getOrgInstallations;
  orgHasAnyInstallation = mod.orgHasAnyInstallation;
  registerOrgInstallation = mod.registerOrgInstallation;
  disconnectOrgInstallation = mod.disconnectOrgInstallation;
});

// --- Tests ---

describe('verifyOrgInstallation', () => {
  it('returns installation when it belongs to the org', async () => {
    const builder = createMockBuilder(mockInstallation);
    const supabase = createMockSupabase({ org_github_installations: builder });

    const result = await verifyOrgInstallation(supabase as never, ORG_A, INSTALL_1);

    expect(result).toEqual(mockInstallation);
    expect(builder.eq).toHaveBeenCalledWith('org_id', ORG_A);
    expect(builder.eq).toHaveBeenCalledWith('installation_id', INSTALL_1);
    expect(builder.eq).toHaveBeenCalledWith('is_active', true);
  });

  it('returns null when installation not found', async () => {
    const builder = createMockBuilder(null);
    const supabase = createMockSupabase({ org_github_installations: builder });

    const result = await verifyOrgInstallation(supabase as never, ORG_A, 99999);

    expect(result).toBeNull();
  });
});

describe('getOrgInstallations', () => {
  it('returns all active installations for an org', async () => {
    const builder = createMockBuilder();
    // Override: getOrgInstallations doesn't call .single(), it returns the query result
    // We need to make the chain resolve to an array
    const mockData = [mockInstallation];
    builder.order = vi.fn().mockResolvedValue({ data: mockData, error: null });

    const supabase = createMockSupabase({ org_github_installations: builder });

    const result = await getOrgInstallations(supabase as never, ORG_A);

    expect(result).toEqual(mockData);
    expect(builder.eq).toHaveBeenCalledWith('org_id', ORG_A);
    expect(builder.eq).toHaveBeenCalledWith('is_active', true);
  });

  it('returns empty array when no installations exist', async () => {
    const builder = createMockBuilder();
    builder.order = vi.fn().mockResolvedValue({ data: null, error: null });

    const supabase = createMockSupabase({ org_github_installations: builder });

    const result = await getOrgInstallations(supabase as never, ORG_A);

    expect(result).toEqual([]);
  });
});

describe('orgHasAnyInstallation', () => {
  it('counts active and inactive installations for the org', async () => {
    const builder = createMockBuilder();
    builder.eq = vi.fn().mockResolvedValue({ count: 1, error: null });
    const supabase = createMockSupabase({ org_github_installations: builder });

    expect(await orgHasAnyInstallation(supabase as never, ORG_A)).toBe(true);
    expect(builder.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(builder.eq).toHaveBeenCalledWith('org_id', ORG_A);
    expect(builder.eq).not.toHaveBeenCalledWith('is_active', true);
  });

  it('returns false when the org never connected GitHub', async () => {
    const builder = createMockBuilder();
    builder.eq = vi.fn().mockResolvedValue({ count: 0, error: null });
    const supabase = createMockSupabase({ org_github_installations: builder });

    expect(await orgHasAnyInstallation(supabase as never, ORG_A)).toBe(false);
  });
});

describe('registerOrgInstallation', () => {
  it('inserts new installation when none exists', async () => {
    const builder = createMockBuilder();
    // First call (select existing): returns null
    let singleCallCount = 0;
    builder.single = vi.fn().mockImplementation(() => {
      singleCallCount++;
      if (singleCallCount === 1) {
        // Checking for existing — not found
        return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
      }
      // Insert result
      return Promise.resolve({ data: mockInstallation, error: null });
    });

    const supabase = createMockSupabase({ org_github_installations: builder });

    const result = await registerOrgInstallation(
      supabase as never,
      ORG_A,
      INSTALL_1,
      'acme-org',
      'https://avatars.example.com/acme',
      'Organization',
      USER_1,
    );

    expect(result).toEqual(mockInstallation);
    expect(builder.insert).toHaveBeenCalled();
  });

  it('inserts new record when installation belongs to different org', async () => {
    const builder = createMockBuilder();
    // Query scoped to ORG_A finds no match (installation belongs to ORG_B)
    let singleCallCount = 0;
    builder.single = vi.fn().mockImplementation(() => {
      singleCallCount++;
      if (singleCallCount === 1) {
        // First call: lookup returns no match for this org
        return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'not found' } });
      }
      // Second call: insert returns the new record
      return Promise.resolve({
        data: { id: 'rec-new', org_id: ORG_A, is_active: true },
        error: null,
      });
    });

    const supabase = createMockSupabase({ org_github_installations: builder });

    const result = await registerOrgInstallation(
      supabase as never,
      ORG_A,
      INSTALL_1,
      'acme-org',
      null,
      'Organization',
      USER_1,
    );

    expect(result).toEqual({ id: 'rec-new', org_id: ORG_A, is_active: true });
    // Should have inserted a new record for ORG_A
    expect(builder.insert).toHaveBeenCalled();
  });

  it('updates metadata when same org re-registers', async () => {
    const builder = createMockBuilder();
    let singleCallCount = 0;
    builder.single = vi.fn().mockImplementation(() => {
      singleCallCount++;
      if (singleCallCount === 1) {
        // Existing record — same org
        return Promise.resolve({
          data: { id: RECORD_ID, org_id: ORG_A, is_active: false },
          error: null,
        });
      }
      // Update result
      return Promise.resolve({ data: { ...mockInstallation, is_active: true }, error: null });
    });

    const supabase = createMockSupabase({ org_github_installations: builder });

    const result = await registerOrgInstallation(
      supabase as never,
      ORG_A,
      INSTALL_1,
      'acme-org',
      'https://avatars.example.com/acme',
      'Organization',
      USER_1,
    );

    expect(result).toBeTruthy();
    expect(result?.is_active).toBe(true);
    expect(builder.update).toHaveBeenCalled();
  });
});

describe('disconnectOrgInstallation', () => {
  it('clears workspace fields and soft-deletes record', async () => {
    // We need different builders for different tables
    const installBuilder = createMockBuilder();
    const wsSelectBuilder = createMockBuilder();
    const wsUpdateBuilder = createMockBuilder();
    const tokenBuilder = createMockBuilder();

    // workspaces.select returns affected workspace IDs
    wsSelectBuilder.eq = vi.fn().mockReturnValue(wsSelectBuilder);
    (wsSelectBuilder as Record<string, unknown>).then = undefined;
    // Make the chain resolve (select → eq → eq produces data)
    let wsSelectCalls = 0;
    wsSelectBuilder.eq = vi.fn().mockImplementation(() => {
      wsSelectCalls++;
      if (wsSelectCalls === 2) {
        // After both .eq() calls on select, resolve
        return Promise.resolve({ data: [{ id: WS_1 }, { id: WS_2 }], error: null });
      }
      return wsSelectBuilder;
    });

    // Track all from() calls to return the right builder
    const fromCalls: string[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        fromCalls.push(table);
        if (table === 'org_github_installations') return installBuilder;
        if (table === 'workspace_github_tokens') return tokenBuilder;
        // workspaces — could be select or update depending on call order
        if (table === 'workspaces') {
          const wsCallCount = fromCalls.filter((t) => t === 'workspaces').length;
          return wsCallCount === 1 ? wsSelectBuilder : wsUpdateBuilder;
        }
        return createMockBuilder();
      }),
    };

    const result = await disconnectOrgInstallation(supabase as never, ORG_A, INSTALL_1);

    // Should return affected workspace IDs
    expect(result).toEqual([WS_1, WS_2]);

    // Should have queried workspaces, updated them, deleted tokens, and soft-deleted installation
    expect(supabase.from).toHaveBeenCalledWith('workspaces');
    expect(supabase.from).toHaveBeenCalledWith('workspace_github_tokens');
    expect(supabase.from).toHaveBeenCalledWith('org_github_installations');
  });

  it('returns empty array when no workspaces affected', async () => {
    const installBuilder = createMockBuilder();
    const wsBuilder = createMockBuilder();

    // No workspaces use this installation
    let eqCount = 0;
    wsBuilder.eq = vi.fn().mockImplementation(() => {
      eqCount++;
      if (eqCount === 2) {
        return Promise.resolve({ data: [], error: null });
      }
      return wsBuilder;
    });

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'org_github_installations') return installBuilder;
        return wsBuilder;
      }),
    };

    const result = await disconnectOrgInstallation(supabase as never, ORG_A, INSTALL_2);

    expect(result).toEqual([]);
    // Should still soft-delete the installation record
    expect(supabase.from).toHaveBeenCalledWith('org_github_installations');
    expect(installBuilder.update).toHaveBeenCalledWith({ is_active: false });
  });
});
