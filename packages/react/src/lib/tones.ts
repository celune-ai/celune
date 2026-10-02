import type { CSSProperties } from 'react';

/** Status, priority, and effort colors as --celune-* references. */
export const STATUS_TONE: Record<string, string> = {
  backlog: 'var(--celune-status-backlog)',
  inbox: 'var(--celune-status-inbox)',
  scoping: 'var(--celune-status-scoping)',
  planning: 'var(--celune-status-planning)',
  in_progress: 'var(--celune-status-in-progress)',
  review: 'var(--celune-status-review)',
  done: 'var(--celune-status-done)',
  archived: 'var(--celune-status-archived)',
};

export const PRIORITY_TONE: Record<string, string> = {
  urgent: 'var(--celune-priority-urgent)',
  high: 'var(--celune-priority-high)',
  normal: 'var(--celune-priority-normal)',
  medium: 'var(--celune-priority-normal)',
  low: 'var(--celune-priority-low)',
};

export const EFFORT_TONE: Record<string, string> = {
  S: 'var(--celune-priority-low)',
  M: 'var(--celune-priority-normal)',
  L: 'var(--celune-priority-high)',
};

/** Filled badge colored by the `--celune-tone` set in `toneStyle`. Overrides Badge variant colors. */
export const TONE_FILL = 'border-(--celune-tone) bg-(--celune-tone) text-(--celune-on-status)';

export function toneStyle(
  tone: string | undefined,
  style?: CSSProperties,
): CSSProperties | undefined {
  if (!tone) return style;
  return { ...style, ['--celune-tone' as string]: tone };
}
