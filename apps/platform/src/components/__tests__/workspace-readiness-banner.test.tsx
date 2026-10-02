/**
 * @vitest-environment jsdom
 *
 * Tests for WorkspaceReadinessBanner component.
 *
 * Covers:
 * - Shows primary failing gate with Resolve button
 * - Shows issues count badge for multiple failures
 * - Renders nothing when all gates pass
 * - Renders nothing while loading
 * - Cannot be dismissed (X is disabled)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockWorkspaceId = 'ws-1';

vi.mock('@/providers/workspace-provider', () => ({
  useWorkspace: () => ({
    activeWorkspace: { id: mockWorkspaceId, name: 'Test WS' },
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

const mockFetchJson = vi.fn();

vi.mock('@/lib/fetch-json', () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

// Import after mocks
import { WorkspaceReadinessBanner } from '../workspace-readiness-banner';

// ── Test data ──────────────────────────────────────────────────────────────

const allPass = {
  gates: {
    api_keys: { status: 'pass', detail: '2 keys configured' },
    onboarding: { status: 'pass', detail: 'Complete' },
    plan: { status: 'pass', detail: 'Pro plan' },
    workspace: { status: 'pass', detail: '1 repo connected' },
    account: { status: 'pass', detail: 'Active owner' },
  },
  ready: true,
};

const someFailing = {
  gates: {
    api_keys: { status: 'fail', detail: 'No provider keys configured' },
    onboarding: { status: 'pass', detail: 'Complete' },
    plan: { status: 'pass', detail: 'Free plan' },
    workspace: { status: 'fail', detail: 'No repository connected' },
    account: { status: 'pass', detail: 'Active member' },
  },
  ready: false,
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WorkspaceReadinessBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceId = 'ws-1';
  });

  it('renders nothing when all gates pass', async () => {
    mockFetchJson.mockResolvedValue(allPass);

    const { container } = render(<WorkspaceReadinessBanner />);

    await waitFor(() => {
      expect(mockFetchJson).toHaveBeenCalled();
    });

    expect(container.firstChild).toBeNull();
  });

  it('shows primary failing gate with Resolve button', async () => {
    mockFetchJson.mockResolvedValue(someFailing);

    render(<WorkspaceReadinessBanner />);

    await waitFor(() => {
      expect(screen.getByText('API keys not configured')).toBeInTheDocument();
    });

    // Issues count badge for 2 failing gates
    expect(screen.getByText('2 issues')).toBeInTheDocument();

    // Resolve button (outline variant)
    expect(screen.getByText('Resolve')).toBeInTheDocument();
  });

  it('has no dismiss button', async () => {
    mockFetchJson.mockResolvedValue(someFailing);

    render(<WorkspaceReadinessBanner />);

    await waitFor(() => {
      expect(screen.getByText('API keys not configured')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Dismiss')).toBeNull();
  });

  it('renders nothing while loading', () => {
    mockFetchJson.mockImplementation(() => new Promise(() => {})); // never resolves

    const { container } = render(<WorkspaceReadinessBanner />);

    expect(container.firstChild).toBeNull();
  });

  it('fails silently on fetch error', async () => {
    mockFetchJson.mockRejectedValue(new Error('Network error'));

    const { container } = render(<WorkspaceReadinessBanner />);

    await waitFor(() => {
      expect(mockFetchJson).toHaveBeenCalled();
    });

    expect(container.firstChild).toBeNull();
  });
});
