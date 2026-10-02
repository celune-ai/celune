// Task status columns for kanban
export const TASK_STATUSES = [
  'backlog',
  'inbox',
  'scoping',
  'planning',
  'in_progress',
  'review',
  'done',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  inbox: 'Inbox',
  scoping: 'Scoping',
  planning: 'Planned',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

export const TASK_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_ASSIGNEES = [
  'unassigned',
  'eric',
  'rick',
  'sage',
  'noir',
  'scan',
  'delv',
  'trek',
  'echo',
  'bond',
  'vita',
  'ward',
] as const;
export type TaskAssignee = (typeof TASK_ASSIGNEES)[number];

export const TASK_ASSIGNEE_LABELS: Record<TaskAssignee, string> = {
  unassigned: 'Unassigned',
  eric: 'Owner',
  rick: 'RICK',
  sage: 'SAGE',
  noir: 'NOIR',
  scan: 'SCAN',
  delv: 'DELV',
  trek: 'TREK',
  echo: 'ECHO',
  bond: 'BOND',
  vita: 'VITA',
  ward: 'WARD',
};

export interface Task {
  id: string;
  title: string;
  description: string | null;
  outcome: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: TaskAssignee;
  project_id: string | null;
  user_id: string | null;
  org_id: string | null;
  workspace_id: string | null;
  category: string[];
  due_date: string | null;
  source: string | null;
  source_ref: string | null;
  vault_path: string | null;
  time_estimate_minutes: number | null;
  time_spent_minutes: number | null;
  parent_id: string | null;
  spawned_by: string | null;
  context_keys: string[];
  subtasks: Subtask[] | null;
  metadata: Record<string, unknown> | null;
  effort: 'S' | 'M' | 'L' | null;
  success_criteria: Record<string, unknown> | null;
  depends_on: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
}

export interface Subtask {
  title: string;
  done: boolean;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author: string;
  content: string;
  user_id: string | null;
  created_at: string;
}

// Severity levels for task impact classification
export const TASK_SEVERITIES = ['critical', 'major', 'minor', 'trivial'] as const;
export type TaskSeverity = (typeof TASK_SEVERITIES)[number];

// Agent workflow metadata (stored in Task.metadata jsonb)
export interface TaskMetadata {
  // Workflow state
  active_session?: boolean;
  active_since?: string;
  scoping_started_at?: string;
  scoped_by?: string;
  scoped_at?: string;
  claimed_at?: string;
  claimed_by?: string;
  review_requested_at?: string;
  review_requested_by?: string;
  completed_by?: string;
  blocked?: boolean;
  blocked_at?: string;
  blocked_reason?: string;
  blocked_by?: string;
  auto_promoted_to_review?: boolean;
  agent_assist_requested?: boolean;
  initiated?: boolean;
  initiated_at?: string;
  initiated_by?: string;
  pre_initiate_status?: string;

  // Sub-agent delegation
  subagent_active?: boolean;
  subagent_type?: string | null;
  subagent_id?: string | null;
  subagent_started_at?: string | null;
  subagent_completed_at?: string | null;

  // Velocity tracking
  tokens_spent?: number;
  cost_cents?: number;
  time_active_minutes?: number;
  auto_unblocked_at?: string;
  agent_handoffs?: string[];
  severity?: TaskSeverity;
  work_started_at?: string;
  work_completed_at?: string;

  // Sprint grouping
  sprint?: number;

  // Estimation
  effort?: string;

  // Git integration
  branch?: string;
  pr_url?: string;
  pr_number?: number;
  pr_comment_id?: number;
}

// For creating/updating tasks
export type TaskInsert = Omit<
  Task,
  'id' | 'created_at' | 'updated_at' | 'completed_at' | 'archived_at'
>;
export type TaskUpdate = Partial<TaskInsert>;
