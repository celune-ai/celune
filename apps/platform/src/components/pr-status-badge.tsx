'use client';

import {
  GitPullRequest,
  GitMerge,
  CircleDot,
  XCircle,
  Circle,
  Check,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import type { ProjectPR } from '@repo/types';

interface PRStatusBadgeProps {
  pr: ProjectPR;
  onClick?: () => void;
}

const STATUS_CONFIG = {
  draft: {
    icon: GitPullRequest,
    color: 'text-foreground-lighter',
    border: 'border-border',
    bg: 'hover:bg-surface-100',
  },
  open: {
    icon: GitPullRequest,
    color: 'text-green-400',
    border: 'border-green-500/40',
    bg: 'hover:bg-green-500/10',
  },
  merged: {
    icon: GitMerge,
    color: 'text-purple-400',
    border: 'border-purple-500/40',
    bg: 'hover:bg-purple-500/10',
  },
  closed: {
    icon: XCircle,
    color: 'text-red-400',
    border: 'border-red-500/40',
    bg: 'hover:bg-red-500/10',
  },
} as const;

const CI_DOT = {
  passing: 'bg-green-500',
  failing: 'bg-red-500',
  pending: 'bg-yellow-500',
} as const;

const REVIEW_ICON = {
  approved: { icon: Check, color: 'text-green-400' },
  changes_requested: { icon: AlertTriangle, color: 'text-amber-400' },
  pending: { icon: Clock, color: 'text-foreground-lighter' },
  commented: { icon: CircleDot, color: 'text-foreground-lighter' },
  dismissed: { icon: Circle, color: 'text-foreground-lighter' },
} as const;

export function PRStatusBadge({ pr, onClick }: PRStatusBadgeProps) {
  const status = pr.status ?? 'open';
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.open;
  const StatusIcon = config.icon;
  const reviewConfig = pr.review_state ? REVIEW_ICON[pr.review_state] : null;
  const ReviewIcon = reviewConfig?.icon ?? null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${config.border} ${config.color} ${config.bg}`}
    >
      <StatusIcon className="h-3 w-3" />
      <span>#{pr.pr_number}</span>
      {pr.ci_status && (
        <span className={`h-1.5 w-1.5 rounded-full ${CI_DOT[pr.ci_status] ?? CI_DOT.pending}`} />
      )}
      {ReviewIcon && <ReviewIcon className={`h-3 w-3 ${reviewConfig!.color}`} />}
    </button>
  );
}
