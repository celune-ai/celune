import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Task } from '@repo/types';
import { CeluneProvider, createRestTransport, useCelune } from '..';
import { useTasksRealtime } from '../hooks';
import { createMockTransport, makeTask } from '../testing';

function Probe() {
  const { transport, canEdit, connection } = useCelune();
  useEffect(() => {
    transport.tasks.list().catch(() => undefined);
  }, [transport]);
  return (
    <div>
      <span data-testid="can-edit">{String(canEdit)}</span>
      <span data-testid="connection">{connection}</span>
    </div>
  );
}

describe('CeluneProvider token lifecycle', () => {
  it('switches to read-only with a reconnect prompt when the refresh fails', async () => {
    const transport = createMockTransport();
    transport.failNext(401);
    const refreshToken = vi.fn().mockRejectedValue(new Error('session gone'));

    render(
      <CeluneProvider
        apiUrl="http://x/v1"
        token="expired"
        workspaceId="ws"
        transport={transport}
        refreshToken={refreshToken}
        pollInterval={0}
      >
        <Probe />
      </CeluneProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('read-only'));
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('can-edit').textContent).toBe('false');
    expect(screen.getByRole('alert').textContent).toMatch(/session expired/i);
  });

  it('reconnects from the prompt when a later refresh succeeds', async () => {
    const transport = createMockTransport();
    transport.failNext(401);
    const refreshToken = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('fresh-token');

    render(
      <CeluneProvider
        apiUrl="http://x/v1"
        token="expired"
        workspaceId="ws"
        transport={transport}
        refreshToken={refreshToken}
        pollInterval={0}
      >
        <Probe />
      </CeluneProvider>,
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('connected'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('can-edit').textContent).toBe('true');
  });

  it('retries a 401 once with the refreshed bearer token on the REST transport', async () => {
    const seen: (string | null)[] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization');
      seen.push(auth);
      if (auth === 'Bearer old') return new Response('{"error":"expired"}', { status: 401 });
      return new Response('[]', { status: 200 });
    });

    function RestProbe() {
      const { transport } = useCelune();
      useEffect(() => {
        transport.tasks.list();
      }, [transport]);
      return null;
    }

    let token = 'old';
    const Harness = () => (
      <CeluneProvider
        apiUrl="http://x/v1"
        token={token}
        workspaceId="ws"
        pollInterval={0}
        refreshToken={async () => (token = 'new')}
        transport={createRestTransport({
          apiUrl: 'http://x/v1',
          getToken: () => token,
          fetch: fetchMock as unknown as typeof fetch,
        })}
      >
        <RestProbe />
      </CeluneProvider>
    );
    render(<Harness />);

    await waitFor(() => expect(seen).toEqual(['Bearer old', 'Bearer new']));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://x/v1/tasks?top_level_only=true');
  });
});

describe('useTasksRealtime', () => {
  function Listener({
    onInsert,
    onUpdate,
  }: {
    onInsert: (t: Task) => void;
    onUpdate: (t: Task) => void;
  }) {
    useTasksRealtime({ onInsert, onUpdate, onDelete: () => undefined });
    return null;
  }

  it('polls the transport and emits inserts and updates when no subscribe adapter is given', async () => {
    const existing = makeTask({ title: 'existing' });
    const transport = createMockTransport({ tasks: [existing] });
    const onInsert = vi.fn();
    const onUpdate = vi.fn();

    render(
      <CeluneProvider
        apiUrl="http://x/v1"
        token="t"
        workspaceId="ws"
        transport={transport}
        pollInterval={20}
      >
        <Listener onInsert={onInsert} onUpdate={onUpdate} />
      </CeluneProvider>,
    );

    await waitFor(() =>
      expect(transport.calls.filter((c) => c === 'tasks.list').length).toBeGreaterThan(0),
    );
    transport.db.tasks.push(makeTask({ title: 'arrived' }));
    existing.updated_at = new Date(Date.now() + 1000).toISOString();

    await waitFor(() =>
      expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ title: 'arrived' })),
    );
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ title: 'existing' })),
    );
  });

  it('uses the subscribe adapter instead of polling when provided', async () => {
    const transport = createMockTransport();
    const unsubscribe = vi.fn();
    let push: ((c: { type: 'INSERT'; new: Task; old: null }) => void) | undefined;
    const subscribe = vi.fn((_channel, onChange) => {
      push = onChange;
      return unsubscribe;
    });
    const onInsert = vi.fn();

    const { unmount } = render(
      <CeluneProvider
        apiUrl="http://x/v1"
        token="t"
        workspaceId="ws-1"
        transport={transport}
        subscribe={subscribe}
        pollInterval={20}
      >
        <Listener onInsert={onInsert} onUpdate={() => undefined} />
      </CeluneProvider>,
    );

    expect(subscribe).toHaveBeenCalledWith(
      { table: 'tasks', filter: { column: 'workspace_id', value: 'ws-1' } },
      expect.any(Function),
    );
    push?.({ type: 'INSERT', new: makeTask({ title: 'live' }), old: null });
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ title: 'live' }));

    await new Promise((r) => setTimeout(r, 60));
    expect(transport.calls).not.toContain('tasks.list');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
