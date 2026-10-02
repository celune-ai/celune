'use client';

import { Badge as BaseBadge, type BadgeProps } from '@repo/ui/components/badge';
import { cn } from '@repo/ui/utils';

/**
 * Token colors for every variant. Palette variants (used for assignee chips) read the
 * --celune-agent-* identity tokens; `-dark` variants are the outlined form of the same color.
 */
const VARIANT_TOKENS: Partial<Record<NonNullable<BadgeProps['variant']>, string>> = {
  emerald: 'border-(--celune-agent-2) bg-(--celune-agent-2) text-(--celune-on-status)',
  pink: 'border-(--celune-agent-4) bg-(--celune-agent-4) text-(--celune-on-status)',
  violet: 'border-(--celune-agent-8) bg-(--celune-agent-8) text-(--celune-on-status)',
  coral: 'border-(--celune-agent-11) bg-(--celune-agent-11) text-(--celune-on-status)',
  gold: 'border-(--celune-status-review) bg-(--celune-status-review) text-(--celune-on-status)',
  blue: 'border-(--celune-agent-9) bg-(--celune-agent-9) text-(--celune-on-status)',
  bronze: 'border-(--celune-priority-high) bg-(--celune-priority-high) text-(--celune-on-status)',
  'emerald-dark': 'border-(--celune-agent-2) bg-transparent text-(--celune-agent-2)',
  'pink-dark': 'border-(--celune-agent-4) bg-transparent text-(--celune-agent-4)',
  'violet-dark': 'border-(--celune-agent-8) bg-transparent text-(--celune-agent-8)',
  'coral-dark': 'border-(--celune-agent-11) bg-transparent text-(--celune-agent-11)',
  'gold-dark': 'border-(--celune-status-review) bg-transparent text-(--celune-status-review)',
  'blue-dark': 'border-(--celune-agent-9) bg-transparent text-(--celune-agent-9)',
  'bronze-dark': 'border-(--celune-priority-high) bg-transparent text-(--celune-priority-high)',
  default: 'border-(--celune-primary) bg-(--celune-primary) text-(--celune-primary-fg)',
  success: 'border-(--celune-status-done) bg-(--celune-status-done) text-(--celune-on-status)',
  brand: 'border-(--celune-status-done) bg-(--celune-status-done) text-(--celune-on-status)',
  secondary: 'border-(--celune-fg) bg-(--celune-fg) text-(--celune-bg)',
  ghost: 'border-(--celune-fg)/80 bg-(--celune-fg)/80 text-(--celune-bg)',
  muted: 'border-(--celune-border-strong) bg-(--celune-surface-hover) text-(--celune-fg)',
  outline: 'border-(--celune-border) bg-transparent text-(--celune-fg)',
  warning: 'border-(--celune-status-review) bg-(--celune-status-review) text-(--celune-on-status)',
  destructive: 'border-(--celune-danger) bg-(--celune-danger) text-(--celune-on-status)',
  'destructive-outline': 'border-(--celune-danger) bg-transparent text-(--celune-danger)',
};

export type { BadgeProps };

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <BaseBadge
      variant={variant}
      className={cn(
        'font-(weight:--celune-font-weight-strong)',
        variant ? VARIANT_TOKENS[variant] : undefined,
        className,
      )}
      {...props}
    />
  );
}
