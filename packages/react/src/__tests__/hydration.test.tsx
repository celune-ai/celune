import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import { TaskBoard, TaskListView } from '../tasks';
import { CeluneTestProvider, createMockTransport, makeTask } from '../testing';

const tasks = [
  makeTask({ title: 'Read task', status: 'planning' }),
  makeTask({ title: 'Unread task', status: 'review', priority: 'high' }),
];

function ui(el: ReactElement) {
  const transport = createMockTransport({ tasks });
  return (
    <CeluneTestProvider transport={transport} pollInterval={5000}>
      {el}
    </CeluneTestProvider>
  );
}

/** Server-renders `el` after earlier requests, then hydrates it and returns hydration errors. */
async function hydrationErrors(el: () => ReactElement) {
  // A long-lived server has rendered other pages, so module-level id counters have moved on.
  renderToString(ui(el()));
  renderToString(ui(el()));
  const html = renderToString(ui(el()));

  // A returning viewer has read one task in an earlier visit.
  localStorage.setItem('read-tasks', JSON.stringify([tasks[0]!.id]));
  localStorage.setItem('task-list-collapsed', JSON.stringify({ review: true }));

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);

  const logged: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
  const recoverable: string[] = [];
  const root = await act(async () =>
    hydrateRoot(container, ui(el()), {
      onRecoverableError: (err) => recoverable.push(String(err)),
    }),
  );
  spy.mockRestore();
  act(() => root.unmount());
  container.remove();
  return [...recoverable, ...logged].filter((m) => /hydrat|did not match/i.test(m));
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

describe('server render then hydrate', () => {
  it('hydrates the board without a mismatch', async () => {
    expect(await hydrationErrors(() => <TaskBoard initialTasks={tasks} />)).toEqual([]);
  });

  it('hydrates the list without a mismatch', async () => {
    expect(await hydrationErrors(() => <TaskListView initialTasks={tasks} />)).toEqual([]);
  });
});
