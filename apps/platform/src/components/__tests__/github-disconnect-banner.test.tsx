/**
 * @vitest-environment jsdom
 *
 * The banner reports a removed GitHub connection only for orgs that connected
 * GitHub before; a new org with no connection sees nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const fetchJson = vi.fn();
vi.mock('@/lib/fetch-json', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('@repo/db/api', () => ({ apiUrl: (path: string) => path }));
vi.mock('@/hooks/use-workspace-href', () => ({
  useWorkspaceHref: () => ({ workspaceHref: (path: string) => path }),
}));
vi.mock('@/providers/workspace-provider', () => ({
  useWorkspace: () => ({ activeWorkspace: { id: 'ws-1' } }),
}));

import { GitHubDisconnectBanner } from '../github-disconnect-banner';

beforeEach(() => {
  sessionStorage.clear();
  fetchJson.mockReset();
});
afterEach(cleanup);

describe('GitHubDisconnectBanner', () => {
  it('stays hidden for an org that never connected GitHub', async () => {
    fetchJson.mockResolvedValue({ installations: [], had_installation: false });
    render(<GitHubDisconnectBanner />);
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays hidden when an installation is active', async () => {
    fetchJson.mockResolvedValue({ installations: [{ id: 1 }], had_installation: true });
    render(<GitHubDisconnectBanner />);
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows when a previously connected org has no active installation', async () => {
    fetchJson.mockResolvedValue({ installations: [], had_installation: true });
    render(<GitHubDisconnectBanner />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
