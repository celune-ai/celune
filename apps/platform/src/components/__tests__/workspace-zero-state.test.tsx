/**
 * @vitest-environment jsdom
 *
 * Tests for WorkspaceZeroState component.
 *
 * Covers:
 * - Admin sees GitHub connect CTA when no installation
 * - Admin sees "Select a Repository" when installation exists
 * - Member sees informational message (no action buttons)
 * - Returns null when no active workspace
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockActiveWorkspace: Record<string, unknown> | null = null;
let mockUserRole: string | null = 'owner';

vi.mock('@/providers/workspace-provider', () => ({
  useWorkspace: () => ({
    activeWorkspace: mockActiveWorkspace,
    userRole: mockUserRole,
  }),
}));

vi.mock('@/hooks/use-workspace-href', () => ({
  useWorkspaceHref: () => ({
    workspaceHref: (path: string) => `/test-ws${path}`,
  }),
}));

vi.mock('@repo/db/api', () => ({
  apiUrl: (path: string) => `http://localhost:3002${path}`,
}));

// Import after mocks
import { WorkspaceZeroState } from '../workspace-zero-state';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WorkspaceZeroState', () => {
  beforeEach(() => {
    mockActiveWorkspace = { id: 'ws-1', name: 'Test WS', github_installation_id: null };
    mockUserRole = 'owner';
  });

  it('returns null when no active workspace', () => {
    mockActiveWorkspace = null;

    const { container } = render(<WorkspaceZeroState />);

    expect(container.firstChild).toBeNull();
  });

  it('shows GitHub connect CTA for admin without installation', () => {
    mockActiveWorkspace = { id: 'ws-1', name: 'Test WS', github_installation_id: null };
    mockUserRole = 'owner';

    render(<WorkspaceZeroState />);

    expect(screen.getByText('Connect your repository to get started')).toBeInTheDocument();
    expect(screen.getByText('Connect to GitHub')).toBeInTheDocument();
  });

  it('shows "Select a Repository" for admin with installation', () => {
    mockActiveWorkspace = { id: 'ws-1', name: 'Test WS', github_installation_id: 12345 };
    mockUserRole = 'admin';

    render(<WorkspaceZeroState />);

    expect(screen.getByText('Select a Repository')).toBeInTheDocument();
    expect(screen.getByText(/Your GitHub App is connected/)).toBeInTheDocument();
  });

  it('shows informational message for member (no action buttons)', () => {
    mockActiveWorkspace = { id: 'ws-1', name: 'Test WS', github_installation_id: null };
    mockUserRole = 'member';

    render(<WorkspaceZeroState />);

    expect(screen.getByText("Your workspace isn't set up yet")).toBeInTheDocument();
    expect(screen.getByText(/workspace admin needs to connect/)).toBeInTheDocument();
    // No action buttons for members
    expect(screen.queryByText('Connect to GitHub')).not.toBeInTheDocument();
    expect(screen.queryByText('Select a Repository')).not.toBeInTheDocument();
  });

  it('shows informational message for viewer', () => {
    mockUserRole = 'viewer';

    render(<WorkspaceZeroState />);

    expect(screen.getByText("Your workspace isn't set up yet")).toBeInTheDocument();
  });

  it('shows settings link for admin', () => {
    mockUserRole = 'owner';

    render(<WorkspaceZeroState />);

    expect(screen.getByText('Go to workspace settings')).toBeInTheDocument();
  });
});
