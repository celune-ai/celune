// Shared constants used across multiple components.
// Import from here rather than redefining locally.

/** Badge variant keyed by task priority */
export const priorityVariants: Record<string, string> = {
  urgent: 'coral',
  high: 'coral',
  normal: 'blue',
  low: 'emerald',
};

/** Badge variant keyed by task status */
export const statusVariants: Record<string, string> = {
  backlog: 'muted',
  inbox: 'pink',
  scoping: 'blue',
  planning: 'blue',
  in_progress: 'blue',
  review: 'gold',
  done: 'emerald',
};

/** Badge variant keyed by effort level */
export const effortVariants: Record<string, string> = {
  S: 'emerald',
  M: 'gold',
  L: 'coral',
};

/** Effort display labels */
export const effortLabels: Record<string, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
};

/** Display labels keyed by task priority; cards, rows, and the drawer share them. */
export const priorityLabels: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/** Sort weight keyed by task priority — lower = higher priority */
export const priorityWeight: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Badge variant keyed by project priority */
export const projectPriorityVariants: Record<string, string> = {
  urgent: 'coral',
  high: 'coral',
  medium: 'blue',
  low: 'emerald',
};

/** Sort weight keyed by project priority — lower = higher priority */
export const projectPriorityWeight: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Assignee badge variant by team category.
 * RICK = green, owner = light-blue, Product team = blue, Personal agents = pink.
 */
export const ASSIGNEE_BADGE_VARIANTS: Record<string, string> = {
  unassigned: 'muted',
  eric: 'blue',
  rick: 'emerald',
  sage: 'violet',
  noir: 'violet',
  scan: 'violet',
  delv: 'blue',
  trek: 'pink',
  echo: 'pink',
  bond: 'pink',
  vita: 'pink',
  ward: 'coral',
};
