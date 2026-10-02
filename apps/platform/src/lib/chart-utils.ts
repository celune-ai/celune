/** Shared Recharts utilities for analytics pages. */

export const TOOLTIP_STYLE = {
  background: 'var(--surface-200)',
  border: '1px solid var(--border-default)',
  borderRadius: '6px',
  fontSize: '11px',
  color: 'var(--foreground-default)',
};

export function fmtCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}
