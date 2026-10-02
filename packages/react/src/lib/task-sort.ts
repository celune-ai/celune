import type { Task, TaskMetadata } from '@repo/types';
import { priorityWeight } from './constants';

export type TaskSortMode = 'manual' | 'priority' | 'sequence' | 'recency';

/**
 * Sort tasks for display based on the selected mode.
 *
 * - manual: preserve existing sort_order (current behavior)
 * - priority: group by priority tier, float overdue tasks up, then sort_order within tier
 * - sequence: tasks with no deps first, then tasks whose deps are all done,
 *   then blocked tasks at bottom — surfaces tasks that unlock the most downstream work
 */
export function sortTasksForDisplay(tasks: Task[], mode: TaskSortMode, today: string): Task[] {
  if (mode === 'manual') return tasks;

  const sorted = [...tasks];

  if (mode === 'recency') {
    sorted.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return bTime - aTime; // newest first
    });
    return sorted;
  }

  if (mode === 'priority') {
    sorted.sort((a, b) => {
      // Overdue tasks float to top within their priority tier
      const aOverdue = isOverdue(a.due_date, today) ? 0 : 1;
      const bOverdue = isOverdue(b.due_date, today) ? 0 : 1;

      // Primary: priority tier
      const aPri = priorityWeight[a.priority] ?? 2;
      const bPri = priorityWeight[b.priority] ?? 2;
      if (aPri !== bPri) return aPri - bPri;

      // Secondary: overdue float-up
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;

      // Tertiary: sort_order within tier
      return a.sort_order - b.sort_order;
    });
    return sorted;
  }

  // mode === 'sequence'
  // Build a map of task IDs for quick lookup
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  sorted.sort((a, b) => {
    const aScore = sequenceScore(a, taskMap, tasks);
    const bScore = sequenceScore(b, taskMap, tasks);
    if (aScore !== bScore) return aScore - bScore;

    // Within same sequence score, sort by priority
    const aPri = priorityWeight[a.priority] ?? 2;
    const bPri = priorityWeight[b.priority] ?? 2;
    if (aPri !== bPri) return aPri - bPri;

    return a.sort_order - b.sort_order;
  });

  // Pin closing-gate tasks to bottom in order: Design Feedback → Code Review → Retro
  const isDesignFeedback = (t: Task) => t.title.toLowerCase().startsWith('design feedback');
  const isCodeReview = (t: Task) => t.title.toLowerCase().startsWith('code review');
  const isRetro = (t: Task) => t.title.toLowerCase().startsWith('project retrospective');
  const isClosing = (t: Task) => isDesignFeedback(t) || isCodeReview(t) || isRetro(t);
  const rest = sorted.filter((t) => !isClosing(t));
  const designFeedbacks = sorted.filter(isDesignFeedback);
  const codeReviews = sorted.filter(isCodeReview);
  const retros = sorted.filter(isRetro);
  return [...rest, ...designFeedbacks, ...codeReviews, ...retros];
}

function isOverdue(dueDate: string | null, today: string): boolean {
  if (!dueDate) return false;
  return dueDate < today;
}

/**
 * Compute a sequence score for ordering:
 * 0 = no deps + unblocks others (most valuable to complete)
 * 1 = no deps, doesn't unblock others
 * 2 = has deps but all deps are done
 * 3 = blocked (has incomplete deps or manually blocked)
 */
function sequenceScore(task: Task, taskMap: Map<string, Task>, allTasks: Task[]): number {
  const meta = (task.metadata ?? {}) as TaskMetadata;
  const deps = (task as Task & { depends_on?: string[] }).depends_on ?? [];
  const isBlocked = !!meta.blocked;

  // Check if all deps are done
  const hasIncompleteDeps = deps.some((depId) => {
    const dep = taskMap.get(depId);
    return dep && dep.status !== 'done';
  });

  if (isBlocked || hasIncompleteDeps) return 3;

  if (deps.length > 0) return 2;

  // No deps — check if this task unblocks others
  const unblocksSomething = allTasks.some((t) => {
    const tDeps = (t as Task & { depends_on?: string[] }).depends_on ?? [];
    return tDeps.includes(task.id);
  });

  return unblocksSomething ? 0 : 1;
}

/** Count overdue tasks in an array */
export function countOverdue(tasks: Task[], today: string): number {
  return tasks.filter((t) => isOverdue(t.due_date, today)).length;
}
