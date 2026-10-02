export const SEVERITY_LEVELS = ['info', 'warning', 'error'] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

export interface ActivityEntry {
  id: string;
  event_type: string;
  severity: SeverityLevel;
  source: string | null;
  title: string;
  details: Record<string, unknown> | null;
  task_id: string | null;
  agent_id: string | null;
  user_id: string | null;
  actor_user_id: string | null;
  workspace_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export type ActivityInsert = Omit<
  ActivityEntry,
  | 'id'
  | 'created_at'
  | 'acknowledged_at'
  | 'details'
  | 'task_id'
  | 'agent_id'
  | 'user_id'
  | 'actor_user_id'
  | 'workspace_id'
> & {
  details?: Record<string, unknown> | null;
  task_id?: string | null;
  agent_id?: string | null;
  user_id?: string | null;
  actor_user_id?: string | null;
  workspace_id?: string | null;
};
