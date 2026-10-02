import { describe, expect, it } from 'vitest';
import { InvalidTransition } from '../errors.ts';
import type { TaskLifecycleStatus } from '../store.ts';
import {
  LIFECYCLE_STATUSES,
  TRANSITIONS,
  assertTransition,
  canTransition,
  isLifecycleStatus,
  transitionPath,
} from '../tasks/transitions.ts';

const EXPECTED: Record<TaskLifecycleStatus, TaskLifecycleStatus[]> = {
  backlog: ['inbox', 'scoping', 'planning', 'archived'],
  inbox: ['backlog', 'scoping', 'planning', 'archived'],
  scoping: ['inbox', 'backlog', 'planning', 'archived'],
  planning: ['scoping', 'backlog', 'in_progress', 'archived'],
  in_progress: ['planning', 'review', 'done', 'archived'],
  review: ['in_progress', 'done', 'archived'],
  done: ['review', 'in_progress', 'archived'],
  archived: ['backlog', 'inbox'],
};

describe('transition table', () => {
  it('covers all eight lifecycle statuses', () => {
    expect([...LIFECYCLE_STATUSES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('matches the PRD table exactly', () => {
    for (const from of LIFECYCLE_STATUSES) {
      expect([...TRANSITIONS[from]].sort()).toEqual([...EXPECTED[from]].sort());
    }
  });

  describe('allowed transitions', () => {
    const allowed = LIFECYCLE_STATUSES.flatMap((from) => EXPECTED[from].map((to) => [from, to]));
    it.each(allowed)('%s -> %s is allowed', (from, to) => {
      expect(canTransition(from as TaskLifecycleStatus, to as TaskLifecycleStatus)).toBe(true);
      expect(() =>
        assertTransition(from as TaskLifecycleStatus, to as TaskLifecycleStatus),
      ).not.toThrow();
    });
  });

  describe('every status pair', () => {
    const pairs = LIFECYCLE_STATUSES.flatMap((from) => LIFECYCLE_STATUSES.map((to) => [from, to]));
    it.each(pairs)('%s -> %s agrees with the table', (from, to) => {
      const expected =
        from === to || EXPECTED[from as TaskLifecycleStatus].includes(to as TaskLifecycleStatus);
      expect(canTransition(from as TaskLifecycleStatus, to as TaskLifecycleStatus)).toBe(expected);
    });
  });

  describe('disallowed transitions', () => {
    const disallowed: [TaskLifecycleStatus, TaskLifecycleStatus][] = [
      ['backlog', 'done'],
      ['inbox', 'in_progress'],
      ['scoping', 'review'],
      ['planning', 'done'],
      ['done', 'backlog'],
      ['archived', 'done'],
      ['in_progress', 'backlog'],
      ['review', 'planning'],
    ];
    it.each(disallowed)('%s -> %s throws InvalidTransition', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(InvalidTransition);
      try {
        assertTransition(from, to);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTransition);
        expect((error as InvalidTransition).from).toBe(from);
        expect((error as InvalidTransition).to).toBe(to);
        expect((error as InvalidTransition).status).toBe(409);
      }
    });
  });

  it('treats a same-status write as a no-op', () => {
    for (const status of LIFECYCLE_STATUSES) {
      expect(canTransition(status, status)).toBe(true);
    }
  });

  it('recognizes lifecycle statuses', () => {
    expect(isLifecycleStatus('archived')).toBe(true);
    expect(isLifecycleStatus('blocked')).toBe(false);
    expect(isLifecycleStatus(42)).toBe(false);
  });

  it('finds the shortest path between statuses', () => {
    expect(transitionPath('inbox', 'in_progress')).toEqual(['planning', 'in_progress']);
    expect(transitionPath('backlog', 'done')).toEqual(['planning', 'in_progress', 'done']);
    expect(transitionPath('done', 'done')).toEqual([]);
    expect(transitionPath('review', 'done')).toEqual(['done']);
  });
});
