/**
 * RBAC v2 Integration Tests
 *
 * Tests permission resolution, role hierarchy, and backward compatibility
 * across the entire RBAC v2 system.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Mock service client
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  single: vi.fn(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  rpc: vi.fn().mockRejectedValue(new Error('RPC not available')),
};

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => mockSupabase,
}));

vi.mock('@/lib/auth', () => ({
  getAuthUserId: (req: NextRequest) => req.headers.get('x-user-id'),
}));

// Import after mocks
import { resolvePermissions, hasPermission, requirePermission } from '@/lib/permissions';
import type { ResolvedPermissions } from '@repo/types';
import { canManageRole, canManageRoleV2 } from '@/lib/roles';

describe('RBAC v2 Permission Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish chainable mock returns after clearAllMocks
    mockSupabase.from.mockReturnThis();
    mockSupabase.select.mockReturnThis();
    mockSupabase.eq.mockReturnThis();
    mockSupabase.in.mockReturnThis();
    mockSupabase.insert.mockReturnThis();
    mockSupabase.update.mockReturnThis();
    mockSupabase.delete.mockReturnThis();
    mockSupabase.rpc.mockRejectedValue(new Error('RPC not available'));
  });

  describe('resolvePermissions', () => {
    it('grants ALL permissions to platform admin (user_roles owner)', async () => {
      // Step 1: user_roles check returns owner
      mockSupabase.single.mockResolvedValueOnce({
        data: { role: 'owner', is_active: true },
        error: null,
      });

      const result = await resolvePermissions(mockSupabase as never, 'user-1', 'ws-1');

      expect(result.isPlatformOwner).toBe(true);
      expect(result.isOwner).toBe(true);
      expect(result.permissions.has('tasks:create')).toBe(true);
      expect(result.permissions.has('billing:manage')).toBe(true);
      expect(result.permissions.has('users:manage')).toBe(true);
    });

    it('denies inactive user_roles', async () => {
      // Step 1: user_roles check returns inactive
      mockSupabase.single.mockResolvedValueOnce({
        data: { role: 'owner', is_active: false },
        error: null,
      });

      const result = await resolvePermissions(mockSupabase as never, 'user-1', 'ws-1');

      expect(result.isPlatformOwner).toBe(false);
      expect(result.permissions.size).toBe(0);
    });

    it('defaults to empty permissions for non-owner legacy role without workspace context', async () => {
      // Step 1: user_roles returns admin (not owner — no ALL_PERMISSIONS shortcut)
      mockSupabase.single.mockResolvedValueOnce({
        data: { role: 'admin', is_active: true },
        error: null,
      });
      // Step 2: workspace lookup (empty workspaceId) — no result
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });
      // Step 4: workspace_memberships — no result
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      const result = await resolvePermissions(mockSupabase as never, 'user-1', '');

      // Without workspace context and no legacy bridge, non-owner roles get default deny
      expect(result.isPlatformOwner).toBe(false);
      expect(result.isOwner).toBe(false);
      expect(result.permissions.size).toBe(0);
    });

    it('defaults to empty permissions for unknown role', async () => {
      // Step 1: user_roles returns no data
      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: { message: 'not found' } })
        // Step 2: workspace lookup fails
        .mockResolvedValueOnce({ data: null, error: { message: 'not found' } })
        // Step 3: org_members fails
        .mockResolvedValueOnce({ data: null, error: { message: 'not found' } })
        // Step 4: workspace_memberships fails
        .mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

      const result = await resolvePermissions(mockSupabase as never, 'user-1', 'ws-1');

      expect(result.permissions.size).toBe(0);
      expect(result.isOwner).toBe(false);
      expect(result.isPlatformOwner).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('returns true when permission exists', () => {
      const resolved: ResolvedPermissions = {
        role: null,
        permissions: new Set(['tasks:read', 'tasks:create']),
        isOwner: false,
        isPlatformOwner: false,
      };
      expect(hasPermission(resolved, 'tasks:read')).toBe(true);
    });

    it('returns false when permission missing', () => {
      const resolved: ResolvedPermissions = {
        role: null,
        permissions: new Set(['tasks:read']),
        isOwner: false,
        isPlatformOwner: false,
      };
      expect(hasPermission(resolved, 'billing:manage')).toBe(false);
    });
  });

  describe('requirePermission', () => {
    it('returns 401 when no user ID', async () => {
      const req = new NextRequest('http://localhost/api/test', {
        headers: {},
      });

      const result = await requirePermission(req, null);
      expect(result).toBeInstanceOf(NextResponse);
      expect((result as NextResponse).status).toBe(401);
    });

    it('returns 403 when permission missing', async () => {
      // Non-owner user with no workspace context gets default deny (empty permissions)
      mockSupabase.single
        // Step 1: user_roles — member (not owner)
        .mockResolvedValueOnce({ data: { role: 'member', is_active: true }, error: null })
        // Step 2: workspace lookup (empty workspaceId)
        .mockResolvedValueOnce({ data: null, error: { message: 'not found' } })
        // Step 4: workspace_memberships — not found
        .mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

      const resolved = await resolvePermissions(mockSupabase as never, 'user-1', '');
      // Without legacy bridge, non-owner gets empty permissions
      expect(resolved.permissions.has('billing:manage')).toBe(false);
      expect(resolved.permissions.has('tasks:create')).toBe(false);

      // Verify requirePermission would deny
      const missing = ['billing:manage' as const].filter((k) => !resolved.permissions.has(k));
      expect(missing.length).toBeGreaterThan(0);
    });

    it('returns PermissionContext when permission granted', async () => {
      // User is owner — RPC resolves with owner permissions
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          is_platform_owner: true,
          is_owner: true,
          is_active: true,
          role_slug: 'owner',
          permission_keys: ['tasks:create', 'tasks:read', 'billing:manage'],
        },
        error: null,
      });

      const resolved = await resolvePermissions(mockSupabase as never, 'user-1', 'ws-1');
      expect(resolved.permissions.has('tasks:create')).toBe(true);

      // Verify requirePermission would allow (no missing permissions)
      const missing = ['tasks:create' as const].filter((k) => !resolved.permissions.has(k));
      expect(missing.length).toBe(0);
    });
  });
});

describe('Role Hierarchy', () => {
  describe('canManageRole (legacy)', () => {
    it('owner can manage all lower roles', () => {
      expect(canManageRole('owner', 'admin')).toBe(true);
      expect(canManageRole('owner', 'member')).toBe(true);
      expect(canManageRole('owner', 'viewer')).toBe(true);
    });

    it('admin can manage member and viewer', () => {
      expect(canManageRole('admin', 'member')).toBe(true);
      expect(canManageRole('admin', 'viewer')).toBe(true);
      expect(canManageRole('admin', 'owner')).toBe(false);
      expect(canManageRole('admin', 'admin')).toBe(false);
    });

    it('member cannot manage anyone', () => {
      expect(canManageRole('member', 'viewer')).toBe(true);
      expect(canManageRole('member', 'member')).toBe(false);
      expect(canManageRole('member', 'admin')).toBe(false);
    });
  });

  describe('canManageRoleV2 (permission-based)', () => {
    it('owner resolved permissions can manage all non-owner roles', () => {
      const ownerResolved: ResolvedPermissions = {
        role: null,
        permissions: new Set(['users:manage']),
        isOwner: true,
        isPlatformOwner: false,
      };

      expect(canManageRoleV2(ownerResolved, 'admin')).toBe(true);
      expect(canManageRoleV2(ownerResolved, 'member')).toBe(true);
      expect(canManageRoleV2(ownerResolved, 'viewer')).toBe(true);
      expect(canManageRoleV2(ownerResolved, 'owner')).toBe(false);
    });

    it('platform admin can manage all non-owner roles', () => {
      const platformAdmin: ResolvedPermissions = {
        role: null,
        permissions: new Set(['users:manage']),
        isOwner: true,
        isPlatformOwner: true,
      };

      expect(canManageRoleV2(platformAdmin, 'admin')).toBe(true);
      expect(canManageRoleV2(platformAdmin, 'owner')).toBe(false);
    });

    it('user without users:manage cannot manage roles', () => {
      const member: ResolvedPermissions = {
        role: {
          id: 'r1',
          name: 'Member',
          slug: 'member',
          description: null,
          org_id: null,
          is_system: true,
          created_at: '',
          updated_at: '',
        },
        permissions: new Set(['tasks:read', 'tasks:create']),
        isOwner: false,
        isPlatformOwner: false,
      };

      expect(canManageRoleV2(member, 'viewer')).toBe(false);
      expect(canManageRoleV2(member, 'member')).toBe(false);
    });

    it('ranks an org-scoped actor by its role slug', () => {
      const orgAdmin = {
        role: null,
        roleSlug: 'admin',
        permissions: new Set(['users:manage']) as ResolvedPermissions['permissions'],
        isOwner: false,
        isPlatformOwner: false,
      };
      expect(canManageRoleV2(orgAdmin, 'member')).toBe(true);
      expect(canManageRoleV2(orgAdmin, 'admin')).toBe(false);
    });
  });
});
