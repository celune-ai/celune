import { describe, it, expect } from 'vitest';
import { priorityVariants, priorityWeight, ASSIGNEE_BADGE_VARIANTS } from '../lib/constants';

describe('priorityVariants', () => {
  it('maps urgent to coral', () => {
    expect(priorityVariants.urgent).toBe('coral');
  });

  it('maps high to coral', () => {
    expect(priorityVariants.high).toBe('coral');
  });

  it('maps normal to blue', () => {
    expect(priorityVariants.normal).toBe('blue');
  });

  it('maps low to emerald', () => {
    expect(priorityVariants.low).toBe('emerald');
  });
});

describe('priorityWeight', () => {
  it('urgent has lowest weight (highest priority)', () => {
    expect(priorityWeight.urgent).toBe(0);
  });

  it('weights are in ascending order: urgent < high < normal < low', () => {
    const weight = (priority: string): number => {
      const value = priorityWeight[priority];
      if (value === undefined) throw new Error(`No weight for ${priority}`);
      return value;
    };
    expect(weight('urgent')).toBeLessThan(weight('high'));
    expect(weight('high')).toBeLessThan(weight('normal'));
    expect(weight('normal')).toBeLessThan(weight('low'));
  });
});

describe('ASSIGNEE_BADGE_VARIANTS', () => {
  it('rick is emerald', () => {
    expect(ASSIGNEE_BADGE_VARIANTS.rick).toBe('emerald');
  });

  it('eric is blue', () => {
    expect(ASSIGNEE_BADGE_VARIANTS.eric).toBe('blue');
  });

  it('product agents are violet', () => {
    expect(ASSIGNEE_BADGE_VARIANTS.sage).toBe('violet');
    expect(ASSIGNEE_BADGE_VARIANTS.noir).toBe('violet');
    expect(ASSIGNEE_BADGE_VARIANTS.scan).toBe('violet');
  });

  it('personal agents are pink', () => {
    expect(ASSIGNEE_BADGE_VARIANTS.trek).toBe('pink');
    expect(ASSIGNEE_BADGE_VARIANTS.echo).toBe('pink');
    expect(ASSIGNEE_BADGE_VARIANTS.bond).toBe('pink');
    expect(ASSIGNEE_BADGE_VARIANTS.vita).toBe('pink');
  });

  it('unassigned is muted', () => {
    expect(ASSIGNEE_BADGE_VARIANTS.unassigned).toBe('muted');
  });
});
