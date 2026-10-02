import { describe, it, expect } from 'vitest';
import { GateDenied, NotFound, InvalidTransition } from '@celuneai/core';
import { coreErrorResponse } from '../core';

describe('coreErrorResponse', () => {
  it('returns the original enforcement body for a gate denial', async () => {
    const details = { error: 'plan_limit', limit: 'max_tasks' };
    const res = coreErrorResponse(
      new GateDenied('task.create', 'plan_limit', { status: 403, details }),
    );
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual(details);
  });

  it('maps not found to 404 and transitions to 409', async () => {
    const notFound = coreErrorResponse(new NotFound('Task', 'abc'));
    expect(notFound?.status).toBe(404);
    expect(await notFound?.json()).toEqual({ error: 'Resource not found' });
    const conflict = coreErrorResponse(new InvalidTransition('backlog', 'done'));
    expect(conflict?.status).toBe(409);
    expect(await conflict?.json()).toEqual({ error: 'Invalid status transition: backlog -> done' });
  });

  it('returns null for errors it does not own', () => {
    expect(coreErrorResponse(new Error('boom'))).toBeNull();
  });
});
