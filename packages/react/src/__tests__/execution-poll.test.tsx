import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { runStatusEvent, useExecutionRealtime } from '../hooks/use-execution-realtime';
import { CeluneTestProvider, createMockTransport } from '../testing';
import type { ExecutionRecord } from '../transport/types';

const run = (id: string, status: string, extra: Record<string, unknown> = {}): ExecutionRecord => ({
  id,
  status,
  ...extra,
});

describe('runStatusEvent', () => {
  it('emits started once per run and a terminal event only after seeing the run', () => {
    expect(runStatusEvent(run('r1', 'pending'), null, 't1')?.type).toBe('started');
    expect(
      runStatusEvent(run('r1', 'streaming'), { id: 'r1', status: 'pending' }, 't1'),
    ).toBeNull();
    expect(runStatusEvent(run('r1', 'completed'), null, 't1')).toBeNull();
    expect(
      runStatusEvent(
        run('r1', 'completed', { outcome: 'ok', tokens_used: 5 }),
        {
          id: 'r1',
          status: 'streaming',
        },
        't1',
      ),
    ).toMatchObject({ type: 'completed', outcome: 'ok', tokens_used: 5, source: 'poll' });
    expect(
      runStatusEvent(
        run('r1', 'failed', { error_message: 'boom' }),
        { id: 'r1', status: 'claimed' },
        't1',
      ),
    ).toMatchObject({ type: 'failed', error: 'boom' });
    expect(
      runStatusEvent(run('r1', 'cancelled'), { id: 'r1', status: 'claimed' }, 't1'),
    ).toMatchObject({ type: 'failed', code: 'cancelled' });
    expect(runStatusEvent(run('r1', 'expired'), { id: 'r1', status: 'claimed' }, 't1')?.type).toBe(
      'timeout',
    );
    expect(
      runStatusEvent(run('r2', 'claimed'), { id: 'r1', status: 'completed' }, 't1')?.type,
    ).toBe('started');
  });
});

describe('useExecutionRealtime without a subscribe adapter', () => {
  it('polls the executions list and reports start and completion', async () => {
    const base = createMockTransport();
    let current: ExecutionRecord = run('r1', 'claimed', { agent_id: 'rick' });
    const transport = {
      ...base,
      executions: {
        list: async () => [current],
        cancel: async () => undefined,
      },
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CeluneTestProvider transport={transport} pollInterval={20}>
        {children}
      </CeluneTestProvider>
    );
    const { result } = renderHook(() => useExecutionRealtime({ taskId: 't1' }), { wrapper });

    await waitFor(() => expect(result.current.isRunning).toBe(true));
    expect(result.current.latestEvent).toMatchObject({ type: 'started', agent_id: 'rick' });

    act(() => {
      current = run('r1', 'completed', { outcome: 'shipped' });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(result.current.latestEvent).toMatchObject({ type: 'completed', outcome: 'shipped' });
    expect(result.current.events.map((e) => e.type)).toEqual(['started', 'completed']);
  });
});
