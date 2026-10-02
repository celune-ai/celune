/**
 * @vitest-environment jsdom
 *
 * PlanProvider on a return from Stripe Checkout (success=1): it ignores the cached
 * plan and stays loading while it polls, until the webhook has activated the plan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useContext } from 'react';

vi.mock('@repo/db/api', () => ({ apiUrl: (path: string) => path }));
let workspaceState: { activeWorkspace: { id: string } | null; isLoading: boolean } = {
  activeWorkspace: { id: 'ws-1' },
  isLoading: false,
};
vi.mock('@/providers/workspace-provider', () => ({
  useWorkspace: () => workspaceState,
}));

const mockFetchJson = vi.fn();
vi.mock('@/lib/fetch-json', () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

import { PlanContext, PlanProvider } from '../plan-provider';

function Probe() {
  const { plan, isLoading, hasNoWorkspace, isUnpaid } = useContext(PlanContext);
  if (isLoading) return <div data-testid="probe">loading</div>;
  if (hasNoWorkspace) return <div data-testid="probe">{`no-workspace unpaid=${isUnpaid}`}</div>;
  return <div data-testid="probe">{plan}</div>;
}

const planData = (plan: string) => ({
  plan,
  limits: { features: [] },
  features: [],
  is_platform_owner: false,
  is_workspace_owner: true,
});

/** In-memory localStorage; the runtime's own may be missing under jsdom. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', memoryStorage());
  mockFetchJson.mockReset();
  workspaceState = { activeWorkspace: { id: 'ws-1' }, isLoading: false };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('PlanProvider', () => {
  it('polls after checkout until the plan activates, without serving the cached unpaid plan', async () => {
    localStorage.setItem('celune:plan:ws-1', JSON.stringify(planData('unpaid')));
    window.history.replaceState(null, '', '/subscribe?success=1');
    mockFetchJson
      .mockResolvedValueOnce(planData('unpaid'))
      .mockResolvedValueOnce(planData('cloud'));

    render(
      <PlanProvider>
        <Probe />
      </PlanProvider>,
    );

    await act(async () => {});
    expect(screen.getByTestId('probe').textContent).toBe('loading');
    expect(mockFetchJson).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mockFetchJson).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('probe').textContent).toBe('cloud');
  });

  it('does not trust a cached unpaid plan outside checkout either', async () => {
    localStorage.setItem('celune:plan:ws-1', JSON.stringify(planData('unpaid')));
    let resolve: (v: unknown) => void = () => {};
    mockFetchJson.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    render(
      <PlanProvider>
        <Probe />
      </PlanProvider>,
    );

    await act(async () => {});
    expect(screen.getByTestId('probe').textContent).toBe('loading');
    await act(async () => resolve(planData('cloud')));
    expect(screen.getByTestId('probe').textContent).toBe('cloud');
  });

  it('stops loading when the user has no workspace, instead of waiting forever', async () => {
    workspaceState = { activeWorkspace: null, isLoading: false };

    render(
      <PlanProvider>
        <Probe />
      </PlanProvider>,
    );

    await act(async () => {});
    expect(screen.getByTestId('probe').textContent).toBe('no-workspace unpaid=false');
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('stays loading while the workspaces are still loading', async () => {
    workspaceState = { activeWorkspace: null, isLoading: true };

    render(
      <PlanProvider>
        <Probe />
      </PlanProvider>,
    );

    await act(async () => {});
    expect(screen.getByTestId('probe').textContent).toBe('loading');
  });
});
