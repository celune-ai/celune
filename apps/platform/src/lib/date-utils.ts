export { formatDueDate, formatRelativeTime, formatTime } from '@celuneai/react/utils';

/** Formats a seconds-based uptime as "Xh Ym" or "Ym" */
export function formatUptime(seconds: number): string {
  if (!seconds) return 'N/A';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ── Weekly date range utilities ──────────────────────────── */

export interface WeekRange {
  start: Date;
  end: Date;
  label: string;
}

/** Returns the Monday-start week containing the given date */
export function getWeekRange(date: Date): WeekRange {
  const d = new Date(date);
  const day = d.getDay();
  // Shift so Monday = 0
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end, label: formatWeekLabel(start, end) };
}

/** Formats a week range as "M/D–M/D" (e.g. "2/24–3/2") */
export function formatWeekLabel(start: Date, end: Date): string {
  const s = `${start.getMonth() + 1}/${start.getDate()}`;
  const e = `${end.getMonth() + 1}/${end.getDate()}`;
  return `${s}–${e}`;
}

/** Returns "Feb 2026" style month label */
export function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Returns "Feb" style short month label */
export function formatShortMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short' });
}

/** Returns all weeks that overlap with a given month */
export function getWeeksInMonth(year: number, month: number): WeekRange[] {
  const weeks: WeekRange[] = [];
  const seen = new Set<string>();

  // Walk through each day of the month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const week = getWeekRange(new Date(year, month, day));
    const key = week.start.toISOString();
    if (!seen.has(key)) {
      seen.add(key);
      weeks.push(week);
    }
  }
  return weeks;
}

/** Returns week ranges going back N weeks from today */
export function getPastWeeks(count: number): WeekRange[] {
  const weeks: WeekRange[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i * 7);
    weeks.push(getWeekRange(d));
  }
  // Deduplicate (in case count * 7 overlaps same week)
  const seen = new Set<string>();
  return weeks.filter((w) => {
    const key = w.start.toISOString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Groups tasks by the week they were completed in, returns entries sorted newest-first */
export function groupTasksByWeek<T extends { completed_at: string | null }>(
  tasks: T[],
): { week: WeekRange; tasks: T[] }[] {
  const map = new Map<string, { week: WeekRange; tasks: T[] }>();

  for (const task of tasks) {
    if (!task.completed_at) continue;
    const week = getWeekRange(new Date(task.completed_at));
    const key = week.start.toISOString();
    const entry = map.get(key);
    if (entry) {
      entry.tasks.push(task);
    } else {
      map.set(key, { week, tasks: [task] });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.week.start.getTime() - a.week.start.getTime());
}
