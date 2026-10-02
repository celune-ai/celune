import { InvalidTransition } from '../errors.ts';
import type { TaskLifecycleStatus } from '../store.ts';

/** Allowed status moves. Blocked is metadata and never a status. */
export const TRANSITIONS: Readonly<Record<TaskLifecycleStatus, readonly TaskLifecycleStatus[]>> = {
  backlog: ['inbox', 'scoping', 'planning', 'archived'],
  inbox: ['backlog', 'scoping', 'planning', 'archived'],
  scoping: ['inbox', 'backlog', 'planning', 'archived'],
  planning: ['scoping', 'backlog', 'in_progress', 'archived'],
  in_progress: ['planning', 'review', 'done', 'archived'],
  review: ['in_progress', 'done', 'archived'],
  done: ['review', 'in_progress', 'archived'],
  archived: ['backlog', 'inbox'],
};

export const LIFECYCLE_STATUSES = Object.keys(TRANSITIONS) as TaskLifecycleStatus[];

export function isLifecycleStatus(value: unknown): value is TaskLifecycleStatus {
  return typeof value === 'string' && value in TRANSITIONS;
}

export function canTransition(from: TaskLifecycleStatus, to: TaskLifecycleStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: TaskLifecycleStatus, to: TaskLifecycleStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransition(from, to);
  }
}

/** Shortest allowed path from one status to another, excluding the start. */
export function transitionPath(
  from: TaskLifecycleStatus,
  to: TaskLifecycleStatus,
): TaskLifecycleStatus[] | null {
  if (from === to) return [];
  const previous = new Map<TaskLifecycleStatus, TaskLifecycleStatus | null>([[from, null]]);
  const queue: TaskLifecycleStatus[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as TaskLifecycleStatus;
    for (const next of TRANSITIONS[current]) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path: TaskLifecycleStatus[] = [];
        let cursor: TaskLifecycleStatus | null = to;
        while (cursor && cursor !== from) {
          path.unshift(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
