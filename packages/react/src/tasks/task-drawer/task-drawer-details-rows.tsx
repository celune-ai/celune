import type { ReactNode } from 'react';
import {
  ExternalLink,
  GitBranch,
  User,
  CheckCircle2,
  Play,
  Tag,
  Timer,
  Gauge,
  Zap,
  ArrowLeftRight,
  FileText,
  Hash,
  ArrowUpRight,
  Calendar,
  Clock,
  Activity,
  Eye,
  AlertCircle,
  DollarSign,
  Hourglass,
  Shield,
  FolderOpen,
} from 'lucide-react';
import { Badge } from '../../components/badge';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { formatTime, formatRelativeTime } from '../../lib/date-utils';
import type { Task, TaskMetadata } from './types';

export const LABEL_COLOR = 'var(--celune-fg-muted)';

/** Consistent row matching MetaRow: 36px min-h, 120px label column, vertically centered */
export function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center gap-3">
      <div
        className="flex w-[120px] shrink-0 items-center gap-2 text-xs"
        style={{ color: LABEL_COLOR }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center text-xs text-(--celune-fg)">{children}</div>
    </div>
  );
}

export type RowData = { icon: ReactNode; label: string; value: ReactNode };

/** Format minutes as "Xh Ym" or "Xm" */
export function fmtMinutes(m: number): string {
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

/** Render rows in a 3-col grid */
export function renderGrid(items: RowData[]) {
  return (
    <div className="grid grid-cols-3 gap-x-6">
      {items.map((r, i) => (
        <DetailRow key={i} icon={r.icon} label={r.label}>
          {r.value}
        </DetailRow>
      ))}
    </div>
  );
}

export interface DetailRowGroups {
  originRows: RowData[];
  peopleRows: RowData[];
  costRows: RowData[];
  tsRows: RowData[];
  sessionRows: RowData[];
}

/** Pure: derives the detail rows shown for a task. */
export function buildDetailRows(task: Task): DetailRowGroups {
  const meta = (task.metadata ?? {}) as TaskMetadata;
  const labels = TASK_ASSIGNEE_LABELS as Record<string, string>;

  // Always show the accordion — there's always at least timestamps + sort order

  /* ── Identity & Origin rows ── */
  const originRows: RowData[] = [];

  if (task.source) {
    originRows.push({
      icon: <ExternalLink className="h-3.5 w-3.5 shrink-0" />,
      label: 'Source',
      value: (
        <span>
          {task.source}
          {task.source_ref ? ` — ${task.source_ref}` : ''}
        </span>
      ),
    });
  }

  if (task.spawned_by) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      task.spawned_by,
    );
    originRows.push({
      icon: <GitBranch className="h-3.5 w-3.5 shrink-0" />,
      label: 'Spawned by',
      value: isUuid ? (
        <span className="font-mono text-(length:--celune-text-3xs)" title={task.spawned_by}>
          {task.spawned_by.slice(0, 8)}
        </span>
      ) : (
        <span>{labels[task.spawned_by] ?? task.spawned_by}</span>
      ),
    });
  }

  if (task.project_id) {
    originRows.push({
      icon: <FolderOpen className="h-3.5 w-3.5 shrink-0" />,
      label: 'Project',
      value: (
        <span className="font-mono text-(length:--celune-text-3xs)">
          {task.project_id.slice(0, 8)}
        </span>
      ),
    });
  }

  if (task.category && task.category.length > 0) {
    originRows.push({
      icon: <Tag className="h-3.5 w-3.5 shrink-0" />,
      label: 'Categories',
      value: (
        <div className="flex flex-wrap gap-1">
          {task.category.map((c) => (
            <Badge key={c} variant="secondary" className="text-xs">
              {c}
            </Badge>
          ))}
        </div>
      ),
    });
  }

  if (meta.severity) {
    originRows.push({
      icon: <Gauge className="h-3.5 w-3.5 shrink-0" />,
      label: 'Severity',
      value: <span className="capitalize">{meta.severity}</span>,
    });
  }

  if (task.vault_path) {
    originRows.push({
      icon: <FileText className="h-3.5 w-3.5 shrink-0" />,
      label: 'Vault',
      value: (
        <span className="truncate font-mono text-(length:--celune-text-3xs)">
          {task.vault_path}
        </span>
      ),
    });
  }

  if (task.context_keys && task.context_keys.length > 0) {
    originRows.push({
      icon: <Hash className="h-3.5 w-3.5 shrink-0" />,
      label: 'Context keys',
      value: (
        <div className="flex flex-wrap gap-1">
          {task.context_keys.map((k) => (
            <Badge key={k} variant="ghost" className="font-mono text-xs">
              {k}
            </Badge>
          ))}
        </div>
      ),
    });
  }

  originRows.push({
    icon: <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />,
    label: 'Sort order',
    value: <span className="tabular-nums">{task.sort_order}</span>,
  });

  /* ── People & Workflow rows ── */
  const peopleRows: RowData[] = [];

  if (meta.claimed_by) {
    peopleRows.push({
      icon: <User className="h-3.5 w-3.5 shrink-0" />,
      label: 'Claimed by',
      value: (
        <span>
          {labels[meta.claimed_by] ?? meta.claimed_by}
          {meta.claimed_at && (
            <span style={{ color: LABEL_COLOR }}> {formatRelativeTime(meta.claimed_at)}</span>
          )}
        </span>
      ),
    });
  }

  if (meta.initiated_by) {
    peopleRows.push({
      icon: <Play className="h-3.5 w-3.5 shrink-0" />,
      label: 'Initiated by',
      value: (
        <span>
          {labels[meta.initiated_by] ?? meta.initiated_by}
          {meta.initiated_at && (
            <span style={{ color: LABEL_COLOR }}> {formatRelativeTime(meta.initiated_at)}</span>
          )}
        </span>
      ),
    });
  }

  if (meta.scoped_by) {
    peopleRows.push({
      icon: <Eye className="h-3.5 w-3.5 shrink-0" />,
      label: 'Scoped by',
      value: (
        <span>
          {labels[meta.scoped_by] ?? meta.scoped_by}
          {meta.scoped_at && (
            <span style={{ color: LABEL_COLOR }}> {formatRelativeTime(meta.scoped_at)}</span>
          )}
        </span>
      ),
    });
  }

  if (meta.completed_by) {
    peopleRows.push({
      icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />,
      label: 'Completed by',
      value: (
        <span>
          {labels[meta.completed_by] ?? meta.completed_by}
          {task.completed_at && (
            <span style={{ color: LABEL_COLOR }}> {formatRelativeTime(task.completed_at)}</span>
          )}
        </span>
      ),
    });
  }

  if (meta.review_requested_by) {
    peopleRows.push({
      icon: <Activity className="h-3.5 w-3.5 shrink-0" />,
      label: 'Review req.',
      value: (
        <span>
          {labels[meta.review_requested_by] ?? meta.review_requested_by}
          {meta.review_requested_at && (
            <span style={{ color: LABEL_COLOR }}>
              {' '}
              {formatRelativeTime(meta.review_requested_at)}
            </span>
          )}
        </span>
      ),
    });
  }

  if (meta.agent_handoffs && meta.agent_handoffs.length > 0) {
    peopleRows.push({
      icon: <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />,
      label: 'Handoffs',
      value: (
        <div className="flex flex-wrap gap-1">
          {meta.agent_handoffs.map((agent, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {labels[agent] ?? agent}
            </Badge>
          ))}
        </div>
      ),
    });
  }

  if (meta.agent_assist_requested) {
    peopleRows.push({
      icon: <Shield className="h-3.5 w-3.5 shrink-0" />,
      label: 'Assist req.',
      value: <span className="text-(--celune-status-review)">Yes</span>,
    });
  }

  if (meta.auto_promoted_to_review) {
    peopleRows.push({
      icon: <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />,
      label: 'Auto-review',
      value: <span>Promoted</span>,
    });
  }

  /* ── Time & Cost rows ── */
  const costRows: RowData[] = [];

  if (task.time_estimate_minutes != null) {
    costRows.push({
      icon: <Hourglass className="h-3.5 w-3.5 shrink-0" />,
      label: 'Estimated',
      value: <span className="tabular-nums">{fmtMinutes(task.time_estimate_minutes)}</span>,
    });
  }

  if (task.time_spent_minutes != null) {
    costRows.push({
      icon: <Timer className="h-3.5 w-3.5 shrink-0" />,
      label: 'Time spent',
      value: <span className="tabular-nums">{fmtMinutes(task.time_spent_minutes)}</span>,
    });
  }

  if (meta.time_active_minutes != null && meta.time_active_minutes > 0) {
    costRows.push({
      icon: <Timer className="h-3.5 w-3.5 shrink-0" />,
      label: 'Active time',
      value: <span className="tabular-nums">{fmtMinutes(meta.time_active_minutes)}</span>,
    });
  }

  if (meta.tokens_spent != null && meta.tokens_spent > 0) {
    costRows.push({
      icon: <Zap className="h-3.5 w-3.5 shrink-0" />,
      label: 'Tokens',
      value: <span className="tabular-nums">{meta.tokens_spent.toLocaleString()}</span>,
    });
  }

  if (meta.cost_cents != null && meta.cost_cents > 0) {
    costRows.push({
      icon: <DollarSign className="h-3.5 w-3.5 shrink-0" />,
      label: 'Cost',
      value: <span className="tabular-nums">${(meta.cost_cents / 100).toFixed(2)}</span>,
    });
  }

  // Compute duration if we have start + end
  if (meta.work_started_at && meta.work_completed_at) {
    const durationMs =
      new Date(meta.work_completed_at).getTime() - new Date(meta.work_started_at).getTime();
    const durationMin = Math.round(durationMs / 60000);
    if (durationMin > 0) {
      costRows.push({
        icon: <Clock className="h-3.5 w-3.5 shrink-0" />,
        label: 'Duration',
        value: <span className="tabular-nums">{fmtMinutes(durationMin)}</span>,
      });
    }
  }

  /* ── Timestamp rows ── */
  const tsRows: RowData[] = [];

  tsRows.push({
    icon: <Calendar className="h-3.5 w-3.5 shrink-0" />,
    label: 'Created',
    value: <span>{formatTime(task.created_at)}</span>,
  });

  if (task.updated_at !== task.created_at) {
    tsRows.push({
      icon: <Clock className="h-3.5 w-3.5 shrink-0" />,
      label: 'Updated',
      value: <span>{formatTime(task.updated_at)}</span>,
    });
  }

  if (meta.work_started_at) {
    tsRows.push({
      icon: <Play className="h-3.5 w-3.5 shrink-0" />,
      label: 'Work started',
      value: <span>{formatTime(meta.work_started_at)}</span>,
    });
  }

  if (meta.work_completed_at) {
    tsRows.push({
      icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />,
      label: 'Work done',
      value: <span>{formatTime(meta.work_completed_at)}</span>,
    });
  }

  if (task.completed_at) {
    tsRows.push({
      icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />,
      label: 'Completed',
      value: <span>{formatTime(task.completed_at)}</span>,
    });
  }

  if (meta.scoping_started_at) {
    tsRows.push({
      icon: <Eye className="h-3.5 w-3.5 shrink-0" />,
      label: 'Scoping start',
      value: <span>{formatTime(meta.scoping_started_at)}</span>,
    });
  }

  if (meta.blocked_at) {
    tsRows.push({
      icon: <AlertCircle className="h-3.5 w-3.5 shrink-0" />,
      label: 'Blocked at',
      value: <span className="text-(--celune-danger)">{formatTime(meta.blocked_at)}</span>,
    });
  }

  if (meta.auto_unblocked_at) {
    tsRows.push({
      icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />,
      label: 'Unblocked',
      value: <span>{formatTime(meta.auto_unblocked_at)}</span>,
    });
  }

  if (task.archived_at) {
    tsRows.push({
      icon: <Activity className="h-3.5 w-3.5 shrink-0" />,
      label: 'Archived',
      value: <span>{formatTime(task.archived_at)}</span>,
    });
  }

  /* ── Active session row ── */
  const sessionRows: RowData[] = [];

  if (meta.active_session) {
    sessionRows.push({
      icon: <Zap className="h-3.5 w-3.5 shrink-0" />,
      label: 'Session',
      value: (
        <span className="text-(--celune-primary)">
          Active{meta.active_since ? ` since ${formatTime(meta.active_since)}` : ''}
        </span>
      ),
    });
  }

  if (meta.blocked) {
    sessionRows.push({
      icon: <AlertCircle className="h-3.5 w-3.5 shrink-0" />,
      label: 'Blocked',
      value: (
        <span className="text-(--celune-danger)">{meta.blocked_reason ?? 'Unknown reason'}</span>
      ),
    });
  }

  return { originRows, peopleRows, costRows, tsRows, sessionRows };
}
