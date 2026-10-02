import { describe, expect, it } from 'vitest';
import { assigneeHandle } from '../assignee-handle';

const id = 'a1b2c3d4-0000-4000-8000-000000000000';

describe('assigneeHandle', () => {
  it('uses the email local part as a slug', () => {
    expect(assigneeHandle({ id, email: 'eric@example.com' })).toBe('eric');
    expect(assigneeHandle({ id, email: 'Jane.Doe+work@example.com' })).toBe('jane-doe-work');
  });

  it('never returns an agent name or unassigned', () => {
    expect(assigneeHandle({ id, email: 'rick@example.com' })).toBe('rick-a1b2c3d4');
    expect(assigneeHandle({ id, email: 'unassigned@example.com' })).toBe('unassigned-a1b2c3d4');
  });

  it('is undefined until the profile has an id and email', () => {
    expect(assigneeHandle({ id: null, email: 'eric@example.com' })).toBeUndefined();
    expect(assigneeHandle({ id, email: null })).toBeUndefined();
    expect(assigneeHandle({ id, email: '+++@example.com' })).toBeUndefined();
  });
});
