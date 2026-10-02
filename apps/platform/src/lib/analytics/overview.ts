import { getWeekRange } from '@/lib/date-utils';

export interface OverviewMetrics {
  total: number;
  inProgress: number;
  doneToday: number;
  doneThisWeek: number;
  overdue: number;
  completionRate: number;
  sourceBreakdown?: Record<string, number>;
}

interface TaskRow {
  id: string;
  status: string;
  completed_at: string | null;
  due_date: string | null;
  source?: string | null;
}

/**
 * Compute overview analytics metrics from a set of tasks.
 * Shared between the API route and server component.
 */
export function computeOverviewMetrics(
  tasks: TaskRow[],
  opts?: { includeSourceBreakdown?: boolean },
): OverviewMetrics {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const thisWeek = getWeekRange(now);

  const total = tasks.length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  const doneToday = tasks.filter((t) => {
    if (t.status !== 'done' || !t.completed_at) return false;
    return new Date(t.completed_at) >= todayStart;
  }).length;

  const doneThisWeek = tasks.filter((t) => {
    if (t.status !== 'done' || !t.completed_at) return false;
    const d = new Date(t.completed_at);
    return d >= thisWeek.start && d <= thisWeek.end;
  }).length;

  const overdue = tasks.filter((t) => {
    if (t.status === 'done' || t.status === 'archived' || !t.due_date) return false;
    return new Date(t.due_date) < now;
  }).length;

  const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const result: OverviewMetrics = {
    total,
    inProgress,
    doneToday,
    doneThisWeek,
    overdue,
    completionRate,
  };

  if (opts?.includeSourceBreakdown) {
    const sourceBreakdown: Record<string, number> = {};
    for (const t of tasks) {
      const src = t.source ?? 'web';
      sourceBreakdown[src] = (sourceBreakdown[src] ?? 0) + 1;
    }
    result.sourceBreakdown = sourceBreakdown;
  }

  return result;
}
