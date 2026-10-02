/**
 * Tests for usePermissions() hook and PermissionGate component.
 *
 * Covers:
 * - Hook returns loading=true initially, loading=false after fetch
 * - can() checks single permission presence (true/false)
 * - Owner always returns true for can() regardless of permissions set
 * - canAll() requires all permissions present
 * - canAny() requires any permission present
 * - Fetch error leaves permissions empty with loading=false
 * - PermissionGate renders children when permission is present
 * - PermissionGate mode="hide" renders nothing (or fallback) when missing
 * - PermissionGate mode="disable" shows overlay when missing
 * - PermissionGate renders children while loading (avoid layout shift)
 * - PermissionGate with array of permissions requires ALL
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockActiveWorkspace = { id: 'ws-1', name: 'Test Workspace' };

vi.mock('@/providers/workspace-provider', () => ({
  useWorkspace: () => ({ activeWorkspace: mockActiveWorkspace }),
}));

vi.mock('@repo/db/api', () => ({
  apiUrl: (path: string) => path,
}));

const mockFetchJson = vi.fn();

vi.mock('@/lib/fetch-json', () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

// ── Import after mocks ──────────────────────────────────────────────────

import { usePermissions } from '@/hooks/use-permissions';
import { PermissionGate } from '@/components/permission-gate';

// ── Helpers ─────────────────────────────────────────────────────────────

function renderHook() {
  const resultRef: { current: ReturnType<typeof usePermissions> | null } = { current: null };
  function TestComponent() {
    resultRef.current = usePermissions();
    return null;
  }
  const utils = render(<TestComponent />);
  return { result: resultRef, ...utils };
}

function makeResponse(
  permissions: string[],
  opts: { isOwner?: boolean; isPlatformOwner?: boolean } = {},
) {
  return {
    permissions,
    isOwner: opts.isOwner ?? false,
    isPlatformOwner: opts.isPlatformOwner ?? false,
  };
}

// ── Tests: usePermissions ──────────────────────────────────────────────

describe('usePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveWorkspace.id = `ws-${Math.random().toString(36).slice(2)}`;
  });

  it('returns loading=true initially', () => {
    mockFetchJson.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook();
    expect(result.current!.loading).toBe(true);
  });

  it('populates permissions after fetch resolves', async () => {
    mockFetchJson.mockResolvedValue(makeResponse(['tasks:read', 'tasks:create']));
    const { result } = renderHook();
    await waitFor(() => expect(result.current!.loading).toBe(false));
    expect(result.current!.can('tasks:read')).toBe(true);
    expect(result.current!.can('tasks:create')).toBe(true);
  });

  it('can() returns false when permission is missing', async () => {
    mockFetchJson.mockResolvedValue(makeResponse(['tasks:read']));
    const { result } = renderHook();
    await waitFor(() => expect(result.current!.loading).toBe(false));
    expect(result.current!.can('tasks:delete')).toBe(false);
  });

  it('owner bypasses all permission checks', async () => {
    mockFetchJson.mockResolvedValue(makeResponse([], { isOwner: true }));
    const { result } = renderHook();
    await waitFor(() => expect(result.current!.loading).toBe(false));
    expect(result.current!.isOwner).toBe(true);
    expect(result.current!.can('billing:manage')).toBe(true);
  });

  it('canAll() requires all permissions', async () => {
    mockFetchJson.mockResolvedValue(makeResponse(['tasks:read', 'tasks:create']));
    const { result } = renderHook();
    await waitFor(() => expect(result.current!.loading).toBe(false));
    expect(result.current!.canAll('tasks:read', 'tasks:create')).toBe(true);
    expect(result.current!.canAll('tasks:read', 'tasks:delete')).toBe(false);
  });

  it('canAny() requires any permission', async () => {
    mockFetchJson.mockResolvedValue(makeResponse(['tasks:read']));
    const { result } = renderHook();
    await waitFor(() => expect(result.current!.loading).toBe(false));
    expect(result.current!.canAny('tasks:read', 'billing:manage')).toBe(true);
    expect(result.current!.canAny('billing:manage', 'tasks:delete')).toBe(false);
  });

  it('on fetch error, loading=false and permissions empty', async () => {
    mockFetchJson.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook();
    await waitFor(() => expect(result.current!.loading).toBe(false));
    expect(result.current!.can('tasks:read')).toBe(false);
    expect(result.current!.permissions.size).toBe(0);
  });
});

// ── Tests: PermissionGate ──────────────────────────────────────────────

describe('PermissionGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveWorkspace.id = `ws-${Math.random().toString(36).slice(2)}`;
  });

  it('renders children when user has the required permission', async () => {
    mockFetchJson.mockResolvedValue(makeResponse(['tasks:read']));
    render(
      <PermissionGate permission="tasks:read">
        <span data-testid="child">Visible</span>
      </PermissionGate>,
    );
    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
  });

  it('mode="hide" renders nothing when permission is missing', async () => {
    mockFetchJson.mockResolvedValue(makeResponse([]));
    const { container } = render(
      <PermissionGate permission="billing:manage" mode="hide">
        <span data-testid="child">Hidden</span>
      </PermissionGate>,
    );
    await waitFor(() => expect(screen.queryByTestId('child')).not.toBeInTheDocument());
    expect(container.innerHTML).toBe('');
  });

  it('mode="hide" with fallback renders fallback', async () => {
    mockFetchJson.mockResolvedValue(makeResponse([]));
    render(
      <PermissionGate
        permission="billing:manage"
        mode="hide"
        fallback={<span data-testid="fallback">No access</span>}
      >
        <span data-testid="child">Hidden</span>
      </PermissionGate>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('child')).not.toBeInTheDocument();
      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });
  });

  it('mode="disable" shows overlay when permission is missing', async () => {
    mockFetchJson.mockResolvedValue(makeResponse([]));
    render(
      <PermissionGate permission="billing:manage">
        <span data-testid="child">Disabled content</span>
      </PermissionGate>,
    );
    await waitFor(() => expect(screen.getByText('Insufficient permissions')).toBeInTheDocument());
    expect(screen.getByText('Disabled content')).toBeInTheDocument();
  });

  it('renders children while loading (avoids layout shift)', () => {
    mockFetchJson.mockReturnValue(new Promise(() => {}));
    render(
      <PermissionGate permission="tasks:read">
        <span data-testid="child">Loading content</span>
      </PermissionGate>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('array of permissions requires ALL present', async () => {
    mockFetchJson.mockResolvedValue(makeResponse(['tasks:read']));
    render(
      <PermissionGate permission={['tasks:read', 'tasks:create']} mode="hide">
        <span data-testid="child">Needs both</span>
      </PermissionGate>,
    );
    await waitFor(() => expect(screen.queryByTestId('child')).not.toBeInTheDocument());
  });

  it('array of permissions renders when ALL present', async () => {
    mockFetchJson.mockResolvedValue(makeResponse(['tasks:read', 'tasks:create']));
    render(
      <PermissionGate permission={['tasks:read', 'tasks:create']}>
        <span data-testid="child">Has both</span>
      </PermissionGate>,
    );
    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
  });
});
