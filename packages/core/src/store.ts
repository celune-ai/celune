import type {
  Task,
  TaskInsert,
  TaskUpdate,
  TaskStatus,
  TaskComment,
  TaskAttachment,
  Project,
  ProjectInsert,
  ProjectUpdate,
  ActivityEntry,
  ActivityInsert,
  AgentStatus,
} from '@repo/types';
import type { HarnessEventLedger } from './harness/harness-service.ts';
import type { WorkspaceScope } from './scope.ts';

/** Task status including the archived state the board hides. */
export type TaskLifecycleStatus = TaskStatus | 'archived';

// --- Tasks ---

export interface TaskListFilter {
  status?: TaskLifecycleStatus;
  projectId?: string;
  assignee?: string;
  topLevelOnly?: boolean;
  ids?: string[];
  /** Follow-ups created from another task (tasks.spawned_by). */
  spawnedBy?: string;
  /** Tasks whose metadata.harness_run belongs to this harness and has not ended. */
  activeHarnessRun?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export type TaskCreateInput = Partial<Omit<TaskInsert, 'workspace_id' | 'org_id' | 'status'>> & {
  title: string;
  status?: TaskLifecycleStatus;
};

export type TaskPatch = Omit<TaskUpdate, 'workspace_id' | 'org_id' | 'status'> & {
  status?: TaskLifecycleStatus;
  completed_at?: string | null;
  archived_at?: string | null;
};

export interface TaskReorderItem {
  id: string;
  status: TaskLifecycleStatus;
  sort_order: number;
}

export interface TaskUpdateOptions {
  /**
   * Compare-and-set: apply the patch only while the row still has this status. The store throws
   * Conflict when the status changed after the caller read it.
   */
  expectedStatus?: TaskLifecycleStatus;
}

export interface TaskStore {
  list(scope: WorkspaceScope, filter?: TaskListFilter): Promise<Task[]>;
  /** Row count for the same filter; limit and offset are ignored. */
  count(scope: WorkspaceScope, filter?: TaskListFilter): Promise<number>;
  get(scope: WorkspaceScope, id: string): Promise<Task>;
  create(scope: WorkspaceScope, input: TaskCreateInput): Promise<Task>;
  update(
    scope: WorkspaceScope,
    id: string,
    patch: TaskPatch,
    options?: TaskUpdateOptions,
  ): Promise<Task>;
  delete(scope: WorkspaceScope, id: string): Promise<void>;
  listChildren(scope: WorkspaceScope, parentId: string): Promise<Task[]>;
  /** Tasks whose depends_on contains the given id. */
  listDependents(scope: WorkspaceScope, id: string): Promise<Task[]>;
  reorder(scope: WorkspaceScope, items: TaskReorderItem[]): Promise<void>;
  /**
   * Replaces the task's metadata only while metadata.harness_run still matches
   * `expected`; resolves null when another write changed the run first.
   * Without it, harness writes are unconditional.
   */
  replaceMetadataIfRun?(
    scope: WorkspaceScope,
    id: string,
    expected: HarnessRunMarker,
    metadata: Record<string, unknown>,
  ): Promise<Task | null>;
}

/** The harness run a write was based on: run id and last applied event id, null when absent. */
export interface HarnessRunMarker {
  runId: string | null;
  lastEventId: string | null;
}

// --- Projects ---

export interface ProjectListFilter {
  namePrefix?: string;
  limit?: number;
}

export type ProjectCreateInput = Partial<Omit<ProjectInsert, 'workspace_id' | 'org_id'>> & {
  name: string;
};

export type ProjectPatch = Omit<ProjectUpdate, 'workspace_id' | 'org_id'>;

export interface ProjectReorderItem {
  id: string;
  sort_order: number;
}

export interface ProjectProgress {
  taskCount: number;
  doneCount: number;
  hasActiveTask: boolean;
}

export interface ProjectStore {
  list(scope: WorkspaceScope, filter?: ProjectListFilter): Promise<Project[]>;
  get(scope: WorkspaceScope, id: string): Promise<Project>;
  create(scope: WorkspaceScope, input: ProjectCreateInput): Promise<Project>;
  update(scope: WorkspaceScope, id: string, patch: ProjectPatch): Promise<Project>;
  delete(scope: WorkspaceScope, id: string): Promise<void>;
  reorder(scope: WorkspaceScope, items: ProjectReorderItem[]): Promise<void>;
  progress(scope: WorkspaceScope): Promise<Record<string, ProjectProgress>>;
  /** True when the project group exists in the scope's workspace. */
  groupExists(scope: WorkspaceScope, groupId: string): Promise<boolean>;
}

// --- Comments ---

export interface CommentInput {
  task_id: string;
  author: string;
  content: string;
  user_id?: string | null;
}

export interface CommentStore {
  list(scope: WorkspaceScope, taskId: string): Promise<TaskComment[]>;
  add(scope: WorkspaceScope, input: CommentInput): Promise<TaskComment>;
}

// --- Attachments ---

export interface AttachmentInput {
  task_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  uploaded_by: string;
  /** Owner column; service-role inserts cannot rely on the auth.uid() default. */
  user_id: string | null;
}

export interface AttachmentStore {
  list(scope: WorkspaceScope, taskId: string): Promise<TaskAttachment[]>;
  add(scope: WorkspaceScope, input: AttachmentInput): Promise<TaskAttachment>;
  remove(scope: WorkspaceScope, taskId: string, attachmentId: string): Promise<void>;
}

// --- Activity ---

export type ActivityInput = Omit<ActivityInsert, 'workspace_id'>;

export interface ActivityListFilter {
  event_type?: string;
  task_id?: string;
  agent_id?: string;
  limit?: number;
  offset?: number;
}

export interface ActivityStore {
  append(scope: WorkspaceScope, entry: ActivityInput): Promise<ActivityEntry>;
  list(
    scope: WorkspaceScope,
    filter?: ActivityListFilter,
  ): Promise<{ data: ActivityEntry[]; total: number }>;
}

// --- Agents ---

export type AgentRunState = AgentStatus['status'];

export interface AgentStatusInput {
  agentName: string;
  status: AgentRunState;
  currentTaskId?: string | null;
  userId?: string | null;
}

/** heartbeat_events.event_type values the database check constraint allows. */
export const HEARTBEAT_EVENT_TYPES = [
  'online',
  'offline',
  'working',
  'idle',
  'stale_reset',
  'task_started',
  'task_completed',
  'alert_fired',
  'health_check',
] as const;

export interface HeartbeatEventInput {
  agentId: string;
  eventType: string;
  metadata?: Record<string, unknown>;
}

export interface AgentStore {
  upsertStatus(scope: WorkspaceScope, input: AgentStatusInput): Promise<void>;
  listStatus(scope: WorkspaceScope): Promise<AgentStatus[]>;
  appendHeartbeat(scope: WorkspaceScope, input: HeartbeatEventInput): Promise<void>;
}

// --- Jobs (ai_job_queue) ---

export type JobRow = Record<string, unknown> & { id: string; status: string };

/** Who executes a job: a polling agent holding an API key, or the in-process worker. */
export type JobRunner = 'external' | 'server';

/** Identity that claims a job. Keys map to claimed_by_key_id, workers to worker_id. */
export type Claimant = { keyId: string } | { workerId: string };

export const ACTIVE_JOB_STATUSES = ['pending', 'claimed', 'streaming'] as const;

export interface PendingJobFilter {
  queueName: string;
  runner: JobRunner;
  jobTypes?: string[];
  limit?: number;
}

export interface JobListFilter {
  runner?: JobRunner;
  statuses?: string[];
  targetType?: 'task' | 'project';
  targetId?: string;
  limit?: number;
  offset?: number;
}

export interface JobLogInput {
  job_id: string;
  step_index: number;
  event_type: string;
  content?: string | null;
  tool_name?: string | null;
  tool_input?: unknown;
  tool_result?: unknown;
  input_tokens?: number;
  output_tokens?: number;
  metadata?: Record<string, unknown>;
}

export type JobLogRow = JobLogInput & { id: string; workspace_id: string; created_at: string };

export interface JobStore {
  enqueue(scope: WorkspaceScope, row: Record<string, unknown>): Promise<JobRow>;
  listPending(scope: WorkspaceScope, filter: PendingJobFilter): Promise<JobRow[]>;
  countPending(scope: WorkspaceScope, queueName: string, runner: JobRunner): Promise<number>;
  /** Jobs still pending, claimed or streaming for one runner. */
  countActive(scope: WorkspaceScope, runner: JobRunner): Promise<number>;
  list(scope: WorkspaceScope, filter?: JobListFilter): Promise<{ rows: JobRow[]; total: number }>;
  get(scope: WorkspaceScope, jobId: string, columns?: string): Promise<JobRow | null>;
  /** Atomic pending -> claimed; null when another claimant won. */
  claim(
    scope: WorkspaceScope,
    jobId: string,
    claimant: Claimant,
    columns?: string,
  ): Promise<JobRow | null>;
  /** Touches a claimed or streaming job owned by the claimant; null when not owned. */
  heartbeat(
    scope: WorkspaceScope,
    jobId: string,
    claimant: Claimant,
    patch: Record<string, unknown>,
  ): Promise<JobRow | null>;
  update(scope: WorkspaceScope, jobId: string, patch: Record<string, unknown>): Promise<void>;
  /** Applies a result patch only while the job is claimed or streaming. */
  submitResult(scope: WorkspaceScope, jobId: string, patch: Record<string, unknown>): Promise<void>;
  /** Cancels a pending, claimed or streaming job; null when it was already terminal. */
  cancel(
    scope: WorkspaceScope,
    jobId: string,
    patch: Record<string, unknown>,
  ): Promise<JobRow | null>;
  /** Returns stale claimed/streaming jobs to pending; resolves the count. */
  expire(scope: WorkspaceScope, staleBefore: string): Promise<number>;
  appendLog(scope: WorkspaceScope, entry: JobLogInput): Promise<JobLogRow>;
  listLogs(
    scope: WorkspaceScope,
    jobId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<JobLogRow[]>;
}

// --- Memory ---

export interface OutcomeMemoryInput {
  taskId: string;
  title: string;
  outcome: string;
  source: string;
  userId?: string | null;
}

export interface MemoryStore {
  storeOutcome(scope: WorkspaceScope, input: OutcomeMemoryInput): Promise<void>;
}

// --- Harness connections ---

/** A workspace's stored harness registration. Holds no credentials. */
export interface HarnessConnection {
  harness: string;
  /** Celune agent id to harness agent id. */
  agents: Record<string, string>;
  /** Adapter settings such as base URLs and run profiles. */
  config: Record<string, unknown>;
  createdBy: string | null;
  updatedAt: string;
}

export interface HarnessConnectionInput {
  harness: string;
  agents: Record<string, string>;
  config: Record<string, unknown>;
  createdBy?: string | null;
}

export interface HarnessConnectionStore {
  get(scope: WorkspaceScope): Promise<HarnessConnection | null>;
  /** Inserts or replaces the workspace's one connection. */
  upsert(scope: WorkspaceScope, input: HarnessConnectionInput): Promise<HarnessConnection>;
  /** Resolves false when the workspace had none. */
  remove(scope: WorkspaceScope): Promise<boolean>;
}

// --- Store ---

export interface Store {
  tasks: TaskStore;
  projects: ProjectStore;
  comments: CommentStore;
  attachments: AttachmentStore;
  activity: ActivityStore;
  agents: AgentStore;
  jobs: JobStore;
  memory?: MemoryStore;
  /** Durable dedupe for harness run events, shared by every API instance. */
  harnessEvents?: HarnessEventLedger;
  /** Harness registrations that survive a restart. */
  harnessConnections?: HarnessConnectionStore;
  transaction<T>(fn: (store: Store) => Promise<T>): Promise<T>;
}
