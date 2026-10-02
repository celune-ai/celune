// Server-side agent runs: the runner = 'server' slice of ai_job_queue.
// ExecutionJob is the read shape the Executions API returns, mapped from a job row.

export const EXECUTION_STATUSES = [
  'pending',
  'claimed',
  'streaming',
  'completed',
  'failed',
  'expired',
  'cancelled',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_TARGETS = ['task', 'project'] as const;
export type ExecutionTarget = (typeof EXECUTION_TARGETS)[number];

export const EXECUTION_LOG_EVENTS = [
  'thinking',
  'tool_call',
  'tool_result',
  'message',
  'error',
  'status_change',
] as const;
export type ExecutionLogEvent = (typeof EXECUTION_LOG_EVENTS)[number];

export interface ExecutionJob {
  id: string;
  workspace_id: string;
  user_id: string;
  org_id: string;
  runner: 'server';
  target_type: ExecutionTarget | null;
  task_id: string | null;
  project_id: string | null;
  status: ExecutionStatus;
  priority: number;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  agent_id: string;
  worker_id: string | null;
  token_budget: number | null;
  tokens_used: number;
  timeout_ms: number;
  attempt: number;
  max_attempts: number;
  context: Record<string, unknown>;
  outcome: string | null;
  error_message: string | null;
  error_code: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ExecutionLog {
  id: string;
  job_id: string;
  workspace_id: string;
  step_index: number;
  event_type: ExecutionLogEvent;
  content: string | null;
  tool_name: string | null;
  tool_input: unknown | null;
  tool_result: unknown | null;
  input_tokens: number;
  output_tokens: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Execution limits per plan. These cap run concurrency and size for stability;
// they are the same for every plan.
export interface ExecutionLimits {
  max_concurrent: number;
  token_budget: number;
  timeout_ms: number;
  max_retries: number;
}

const EXECUTION_LIMITS: ExecutionLimits = {
  max_concurrent: 10,
  token_budget: 500000,
  timeout_ms: 600000,
  max_retries: 5,
};

export const EXECUTION_TIER_LIMITS: Record<string, ExecutionLimits> = {
  cloud: EXECUTION_LIMITS,
  enterprise: EXECUTION_LIMITS,
  platform_owner: EXECUTION_LIMITS,
};
