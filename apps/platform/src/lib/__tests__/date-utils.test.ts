import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatDueDate,
  formatRelativeTime,
  formatTime,
  formatUptime,
  getWeekRange,
  formatWeekLabel,
  getWeeksInMonth,
  groupTasksByWeek,
} from '../date-utils';

/* ── formatDueDate ───────────────────────────────────── */

describe('formatDueDate', () => {
  const today = '2026-03-02';

  it('returns null for null due_date', () => {
    expect(formatDueDate(null, today)).toBeNull();
  });

  it('returns date with "(Today)" when due_date equals today', () => {
    const result = formatDueDate('2026-03-02', today);
    expect(result).toEqual({ label: 'Mar 2, 2026 (Today)', isOverdue: false });
  });

  it('returns date with "(Tomorrow)" when due_date is one day ahead', () => {
    const result = formatDueDate('2026-03-03', today);
    expect(result).toEqual({ label: 'Mar 3, 2026 (Tomorrow)', isOverdue: false });
  });

  it('returns date with "(N days)" for future dates within 30 days', () => {
    const result = formatDueDate('2026-03-05', today);
    expect(result).toEqual({ label: 'Mar 5, 2026 (3 days)', isOverdue: false });
  });

  it('returns date without days count for dates beyond 30 days', () => {
    const result = formatDueDate('2026-05-01', today);
    expect(result).toEqual({ label: 'May 1, 2026', isOverdue: false });
  });

  it('returns date with "(1 day overdue)" for yesterday', () => {
    const result = formatDueDate('2026-03-01', today);
    expect(result).toEqual({ label: 'Mar 1, 2026 (1 day overdue)', isOverdue: true });
  });

  it('returns date with "(N days overdue)" for older dates', () => {
    const result = formatDueDate('2026-02-27', today);
    expect(result).toEqual({ label: 'Feb 27, 2026 (3 days overdue)', isOverdue: true });
  });

  it('uses current date when today param is omitted', () => {
    const result = formatDueDate('3000-01-01');
    expect(result?.isOverdue).toBe(false);
  });
});

/* ── formatRelativeTime ──────────────────────────────── */

describe('formatRelativeTime', () => {
  afterEach(() => vi.useRealTimers());

  it('returns "just now" for very recent timestamps', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('just now');
  });

  it('returns "Xm ago" for minutes-old timestamps', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('returns "Xh ago" for hours-old timestamps', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
  });

  it('returns "Xd ago" for days-old timestamps', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago');
  });

  it('returns "just now" for future timestamps', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(formatRelativeTime(future)).toBe('just now');
  });
});

/* ── formatTime ──────────────────────────────────────── */

describe('formatTime', () => {
  it('returns "Never" for null', () => {
    expect(formatTime(null)).toBe('Never');
  });

  it('returns a locale time string for valid timestamps', () => {
    const result = formatTime('2026-03-02T14:30:00Z');
    // Just check it's a non-empty string (locale-dependent)
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('Never');
  });
});

/* ── formatUptime ────────────────────────────────────── */

describe('formatUptime', () => {
  it('returns "N/A" for 0 seconds', () => {
    expect(formatUptime(0)).toBe('N/A');
  });

  it('returns "Xm" for sub-hour durations', () => {
    expect(formatUptime(300)).toBe('5m');
  });

  it('returns "Xh Ym" for multi-hour durations', () => {
    expect(formatUptime(3660)).toBe('1h 1m');
  });

  it('returns "Xh 0m" for exact hours', () => {
    expect(formatUptime(7200)).toBe('2h 0m');
  });
});

/* ── getWeekRange ────────────────────────────────────── */

describe('getWeekRange', () => {
  it('returns Monday as start of the week', () => {
    // 2026-03-02 is a Monday
    const week = getWeekRange(new Date(2026, 2, 2));
    expect(week.start.getDay()).toBe(1); // Monday
  });

  it('returns Sunday as end of the week', () => {
    const week = getWeekRange(new Date(2026, 2, 2));
    expect(week.end.getDay()).toBe(0); // Sunday
  });

  it('handles Sunday input (should go back to previous Monday)', () => {
    // 2026-03-08 is a Sunday
    const week = getWeekRange(new Date(2026, 2, 8));
    expect(week.start.getDate()).toBe(2); // Monday March 2
  });

  it('label format is "M/D–M/D"', () => {
    const week = getWeekRange(new Date(2026, 2, 2));
    expect(week.label).toMatch(/\d+\/\d+–\d+\/\d+/);
  });
});

/* ── formatWeekLabel ─────────────────────────────────── */

describe('formatWeekLabel', () => {
  it('formats start and end dates as "M/D–M/D"', () => {
    const start = new Date(2026, 1, 24); // Feb 24
    const end = new Date(2026, 2, 2); // Mar 2
    expect(formatWeekLabel(start, end)).toBe('2/24–3/2');
  });
});

/* ── getWeeksInMonth ─────────────────────────────────── */

describe('getWeeksInMonth', () => {
  it('returns all weeks overlapping with the month', () => {
    const weeks = getWeeksInMonth(2026, 2); // March 2026
    expect(weeks.length).toBeGreaterThanOrEqual(4);
    expect(weeks.length).toBeLessThanOrEqual(6);
  });

  it('returns unique weeks (no duplicates)', () => {
    const weeks = getWeeksInMonth(2026, 2);
    const keys = weeks.map((w) => w.start.toISOString());
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/* ── groupTasksByWeek ────────────────────────────────── */

describe('groupTasksByWeek', () => {
  it('groups tasks by the week they were completed', () => {
    const tasks = [
      { completed_at: '2026-03-03T10:00:00Z', id: 'a' },
      { completed_at: '2026-03-04T10:00:00Z', id: 'b' },
      { completed_at: '2026-02-24T10:00:00Z', id: 'c' },
    ];
    const groups = groupTasksByWeek(tasks);
    expect(groups.length).toBe(2); // two different weeks
  });

  it('skips tasks with null completed_at', () => {
    const tasks = [
      { completed_at: null, id: 'a' },
      { completed_at: '2026-03-03T10:00:00Z', id: 'b' },
    ];
    const groups = groupTasksByWeek(tasks);
    expect(groups.length).toBe(1);
    expect(groups[0].tasks.length).toBe(1);
  });

  it('returns groups sorted newest-first', () => {
    const tasks = [
      { completed_at: '2026-02-01T10:00:00Z', id: 'old' },
      { completed_at: '2026-03-03T10:00:00Z', id: 'new' },
    ];
    const groups = groupTasksByWeek(tasks);
    expect(groups[0].week.start.getTime()).toBeGreaterThan(groups[1].week.start.getTime());
  });

  it('returns empty array for empty input', () => {
    expect(groupTasksByWeek([])).toEqual([]);
  });
});
