/** Format a due date as "Mar 3, 2024 (16 days)" with overdue detection */
export function formatDueDate(
  dueDate: string | null,
  today?: string,
): { label: string; isOverdue: boolean } | null {
  if (!dueDate) return null;

  // Parse as local date to avoid UTC off-by-one
  const todayStr = today ?? new Date().toISOString().slice(0, 10);
  const todayDate = new Date(todayStr + 'T00:00:00');
  const dueLocal = new Date(dueDate + 'T00:00:00');

  const diffMs = dueLocal.getTime() - todayDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const formatted = dueLocal.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (diffDays < 0) {
    const abs = Math.abs(diffDays);
    const suffix = abs === 1 ? '1 day overdue' : `${abs} days overdue`;
    return { label: `${formatted} (${suffix})`, isOverdue: true };
  }
  if (diffDays === 0) return { label: `${formatted} (Today)`, isOverdue: false };
  if (diffDays === 1) return { label: `${formatted} (Tomorrow)`, isOverdue: false };
  if (diffDays <= 30) return { label: `${formatted} (${diffDays} days)`, isOverdue: false };
  return { label: formatted, isOverdue: false };
}

/** Returns a human-readable relative time string ("just now", "5m ago", "2h ago", "3d ago") */
export function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Formats an ISO timestamp as a locale time string, or "Never" if null */
export function formatTime(ts: string | null): string {
  if (!ts) return 'Never';
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}
