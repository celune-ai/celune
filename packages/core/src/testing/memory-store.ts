import type {
  ActivityEntry,
  AgentStatus,
  Project,
  Task,
  TaskAttachment,
  TaskComment,
} from '@repo/types';
import { NotFound, statusConflict } from '../errors.ts';
import { ACTIVE_RUN_STATUSES } from '../harness/types.ts';
import { HEARTBEAT_EVENT_TYPES } from '../store.ts';

/** Mirrors heartbeat_events_event_type_check so tests fail where Postgres would. */
const HEARTBEAT_TYPES: ReadonlySet<string> = new Set(HEARTBEAT_EVENT_TYPES);
import type { WorkspaceScope } from '../scope.ts';
import type {
  ActivityInput,
  ActivityListFilter,
  AgentStatusInput,
  AttachmentInput,
  CommentInput,
  Claimant,
  HarnessConnection,
  HarnessConnectionInput,
  HarnessConnectionStore,
  HarnessRunMarker,
  HeartbeatEventInput,
  JobListFilter,
  JobLogInput,
  JobLogRow,
  JobRow,
  JobRunner,
  OutcomeMemoryInput,
  PendingJobFilter,
  ProjectCreateInput,
  ProjectListFilter,
  ProjectPatch,
  ProjectProgress,
  ProjectReorderItem,
  Store,
  TaskCreateInput,
  TaskListFilter,
  TaskPatch,
  TaskUpdateOptions,
  TaskReorderItem,
} from '../store.ts';

export interface HeartbeatEventRow extends HeartbeatEventInput {
  workspace_id: string;
  created_at: string;
}

export interface OutcomeMemoryRow extends OutcomeMemoryInput {
  workspace_id: string;
}

let counter = 0;
const ID_PREFIX: Record<string, string> = {
  task: '7a5c0000',
  proj: '9d0a0000',
  job: '10b00000',
  comment: 'c0330000',
  attach: 'a77a0000',
  activity: 'ac710000',
  agent: 'a6e70000',
  group: '96e00000',
};
function nextId(kind: string): string {
  counter += 1;
  const n = counter.toString(16).padStart(12, '0');
  return `${ID_PREFIX[kind] ?? '00000000'}-0000-4000-8000-${n}`;
}

/** In-memory Store for unit tests. Every method filters by scope.workspaceId. */
export class InMemoryStore implements Store {
  readonly taskRows = new Map<string, Task>();
  readonly projectRows = new Map<string, Project>();
  /** Project group id to its workspace id. */
  readonly groupRows = new Map<string, string>();
  readonly commentRows: TaskComment[] = [];
  readonly attachmentRows: TaskAttachment[] = [];
  readonly activityRows: ActivityEntry[] = [];
  readonly agentRows = new Map<string, AgentStatus>();
  readonly heartbeatRows: HeartbeatEventRow[] = [];
  readonly jobRows = new Map<string, JobRow>();
  readonly jobLogRows: JobLogRow[] = [];
  readonly memoryRows: OutcomeMemoryRow[] = [];
  /** Workspace id to its stored harness connection. */
  readonly harnessConnectionRows = new Map<string, HarnessConnection>();
  private clock: () => Date;

  constructor(options: { clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  private now(): string {
    return this.clock().toISOString();
  }

  /** Mirrors the Supabase adapter: child rows need their task in the scope's workspace. */
  private taskInScope(scope: WorkspaceScope, taskId: string): void {
    const task = this.taskRows.get(taskId);
    if (!task || task.workspace_id !== scope.workspaceId) throw new NotFound('Task', taskId);
  }

  // --- seeding helpers ---

  seedTask(scope: WorkspaceScope, partial: Partial<Task> & { title: string }): Task {
    const now = this.now();
    const task: Task = {
      id: partial.id ?? nextId('task'),
      title: partial.title,
      description: partial.description ?? null,
      outcome: partial.outcome ?? null,
      status: partial.status ?? 'inbox',
      priority: partial.priority ?? 'normal',
      assignee: partial.assignee ?? 'unassigned',
      project_id: partial.project_id ?? null,
      user_id: partial.user_id ?? null,
      org_id: scope.orgId,
      workspace_id: scope.workspaceId,
      category: partial.category ?? [],
      due_date: partial.due_date ?? null,
      source: partial.source ?? null,
      source_ref: partial.source_ref ?? null,
      vault_path: partial.vault_path ?? null,
      time_estimate_minutes: partial.time_estimate_minutes ?? null,
      time_spent_minutes: partial.time_spent_minutes ?? null,
      parent_id: partial.parent_id ?? null,
      spawned_by: partial.spawned_by ?? null,
      context_keys: partial.context_keys ?? [],
      subtasks: partial.subtasks ?? null,
      metadata: partial.metadata ?? {},
      effort: partial.effort ?? null,
      success_criteria: partial.success_criteria ?? null,
      depends_on: partial.depends_on ?? [],
      sort_order: partial.sort_order ?? this.taskRows.size * 1000,
      created_at: partial.created_at ?? now,
      updated_at: partial.updated_at ?? now,
      completed_at: partial.completed_at ?? null,
      archived_at: partial.archived_at ?? null,
    };
    this.taskRows.set(task.id, task);
    return task;
  }

  seedGroup(scope: WorkspaceScope, id: string = nextId('group')): string {
    this.groupRows.set(id, scope.workspaceId);
    return id;
  }

  seedProject(scope: WorkspaceScope, partial: Partial<Project> & { name: string }): Project {
    const now = this.now();
    const project: Project = {
      id: partial.id ?? nextId('proj'),
      name: partial.name,
      description: partial.description ?? null,
      status: partial.status ?? 'active',
      project_type: partial.project_type ?? 'feature',
      priority: partial.priority ?? 'medium',
      category: partial.category ?? null,
      target_date: partial.target_date ?? null,
      vault_path: partial.vault_path ?? null,
      metadata: partial.metadata ?? null,
      prd_content: partial.prd_content ?? null,
      prd_metadata: partial.prd_metadata ?? null,
      group_id: partial.group_id ?? null,
      user_id: partial.user_id ?? null,
      org_id: scope.orgId,
      workspace_id: scope.workspaceId,
      sort_order: partial.sort_order ?? this.projectRows.size * 1000,
      created_at: partial.created_at ?? now,
      updated_at: partial.updated_at ?? now,
    };
    this.projectRows.set(project.id, project);
    return project;
  }

  seedJob(scope: WorkspaceScope, partial: Partial<JobRow> = {}): JobRow {
    const job: JobRow = {
      id: (partial.id as string) ?? nextId('job'),
      status: (partial.status as string) ?? 'pending',
      queue_name: 'default',
      runner: 'external',
      job_type: 'chat',
      priority: 0,
      attempt: 0,
      max_attempts: 3,
      retry_after: null,
      target_type: null,
      target_id: null,
      claimed_by_key_id: null,
      worker_id: null,
      metadata: {},
      created_at: this.now(),
      ...partial,
      workspace_id: scope.workspaceId,
    };
    this.jobRows.set(job.id, job);
    return job;
  }

  private inScope<T extends { workspace_id?: string | null }>(
    scope: WorkspaceScope,
    row: T,
  ): boolean {
    return row.workspace_id === scope.workspaceId;
  }

  // --- tasks ---

  tasks = {
    list: async (scope: WorkspaceScope, filter: TaskListFilter = {}): Promise<Task[]> => {
      const rows = this.filterTasks(scope, filter);
      rows.sort((a, b) => a.sort_order - b.sort_order);
      const start = filter.offset ?? 0;
      const end = filter.limit ? start + filter.limit : undefined;
      return rows.slice(start, end).map((t) => ({ ...t }));
    },
    count: async (scope: WorkspaceScope, filter: TaskListFilter = {}): Promise<number> => {
      return this.filterTasks(scope, filter).length;
    },
    get: async (scope: WorkspaceScope, id: string): Promise<Task> => {
      const row = this.taskRows.get(id);
      if (!row || !this.inScope(scope, row)) throw new NotFound('Task', id);
      return { ...row };
    },
    create: async (scope: WorkspaceScope, input: TaskCreateInput): Promise<Task> => {
      const { status, ...rest } = input;
      return this.seedTask(scope, {
        ...(rest as Partial<Task>),
        title: input.title,
        status: (status ?? 'inbox') as Task['status'],
      });
    },
    update: async (
      scope: WorkspaceScope,
      id: string,
      patch: TaskPatch,
      options: TaskUpdateOptions = {},
    ): Promise<Task> => {
      const row = this.taskRows.get(id);
      if (!row || !this.inScope(scope, row)) throw new NotFound('Task', id);
      if (options.expectedStatus !== undefined && row.status !== options.expectedStatus) {
        throw statusConflict(id, options.expectedStatus);
      }
      const next = { ...row, ...(patch as Partial<Task>), updated_at: this.now() };
      this.taskRows.set(id, next);
      return { ...next };
    },
    delete: async (scope: WorkspaceScope, id: string): Promise<void> => {
      const row = this.taskRows.get(id);
      if (!row || !this.inScope(scope, row)) throw new NotFound('Task', id);
      this.taskRows.delete(id);
    },
    listChildren: async (scope: WorkspaceScope, parentId: string): Promise<Task[]> => {
      return [...this.taskRows.values()]
        .filter((t) => this.inScope(scope, t) && t.parent_id === parentId)
        .map((t) => ({ ...t }));
    },
    listDependents: async (scope: WorkspaceScope, id: string): Promise<Task[]> => {
      return [...this.taskRows.values()]
        .filter((t) => this.inScope(scope, t) && (t.depends_on ?? []).includes(id))
        .map((t) => ({ ...t }));
    },
    replaceMetadataIfRun: async (
      scope: WorkspaceScope,
      id: string,
      expected: HarnessRunMarker,
      metadata: Record<string, unknown>,
    ): Promise<Task | null> => {
      const row = this.taskRows.get(id);
      if (!row || !this.inScope(scope, row)) throw new NotFound('Task', id);
      const run = (
        row.metadata as { harness_run?: { run_id?: string; last_event_id?: string } } | null
      )?.harness_run;
      if ((run?.run_id ?? null) !== expected.runId) return null;
      if ((run?.last_event_id ?? null) !== expected.lastEventId) return null;
      const next = { ...row, metadata: metadata as Task['metadata'], updated_at: this.now() };
      this.taskRows.set(id, next);
      return { ...next };
    },
    reorder: async (scope: WorkspaceScope, items: TaskReorderItem[]): Promise<void> => {
      for (const item of items) {
        const row = this.taskRows.get(item.id);
        if (!row || !this.inScope(scope, row)) continue;
        this.taskRows.set(item.id, {
          ...row,
          status: item.status as Task['status'],
          sort_order: item.sort_order,
        });
      }
    },
  };

  private filterTasks(scope: WorkspaceScope, filter: TaskListFilter): Task[] {
    let rows = [...this.taskRows.values()].filter((t) => this.inScope(scope, t));
    if (!filter.includeArchived) rows = rows.filter((t) => (t.status as string) !== 'archived');
    if (filter.status) rows = rows.filter((t) => t.status === filter.status);
    if (filter.projectId) rows = rows.filter((t) => t.project_id === filter.projectId);
    if (filter.assignee) rows = rows.filter((t) => t.assignee === filter.assignee);
    if (filter.topLevelOnly) rows = rows.filter((t) => t.parent_id === null);
    if (filter.ids) rows = rows.filter((t) => filter.ids!.includes(t.id));
    if (filter.spawnedBy) rows = rows.filter((t) => t.spawned_by === filter.spawnedBy);
    if (filter.activeHarnessRun) {
      const harness = filter.activeHarnessRun;
      rows = rows.filter((t) => {
        const run = (t.metadata as { harness_run?: { harness?: string; status?: string } } | null)
          ?.harness_run;
        return (
          run?.harness === harness &&
          (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status ?? '')
        );
      });
    }
    return rows;
  }

  // --- projects ---

  projects = {
    list: async (scope: WorkspaceScope, filter: ProjectListFilter = {}): Promise<Project[]> => {
      let rows = [...this.projectRows.values()].filter((p) => this.inScope(scope, p));
      if (filter.namePrefix) {
        const prefix = filter.namePrefix.toLowerCase();
        rows = rows.filter((p) => p.name.toLowerCase().startsWith(prefix));
      }
      rows.sort((a, b) => a.sort_order - b.sort_order);
      if (filter.limit) rows = rows.slice(0, filter.limit);
      return rows.map((p) => ({ ...p }));
    },
    get: async (scope: WorkspaceScope, id: string): Promise<Project> => {
      const row = this.projectRows.get(id);
      if (!row || !this.inScope(scope, row)) throw new NotFound('Project', id);
      return { ...row };
    },
    create: async (scope: WorkspaceScope, input: ProjectCreateInput): Promise<Project> => {
      return this.seedProject(scope, input as Partial<Project> & { name: string });
    },
    update: async (scope: WorkspaceScope, id: string, patch: ProjectPatch): Promise<Project> => {
      const row = this.projectRows.get(id);
      if (!row || !this.inScope(scope, row)) throw new NotFound('Project', id);
      const next = { ...row, ...(patch as Partial<Project>), updated_at: this.now() };
      this.projectRows.set(id, next);
      return { ...next };
    },
    delete: async (scope: WorkspaceScope, id: string): Promise<void> => {
      const row = this.projectRows.get(id);
      if (!row || !this.inScope(scope, row)) throw new NotFound('Project', id);
      this.projectRows.delete(id);
    },
    groupExists: async (scope: WorkspaceScope, groupId: string): Promise<boolean> => {
      return this.groupRows.get(groupId) === scope.workspaceId;
    },
    reorder: async (scope: WorkspaceScope, items: ProjectReorderItem[]): Promise<void> => {
      for (const item of items) {
        const row = this.projectRows.get(item.id);
        if (!row || !this.inScope(scope, row)) continue;
        this.projectRows.set(item.id, { ...row, sort_order: item.sort_order });
      }
    },
    progress: async (scope: WorkspaceScope): Promise<Record<string, ProjectProgress>> => {
      const map: Record<string, ProjectProgress> = {};
      for (const t of this.taskRows.values()) {
        if (!this.inScope(scope, t) || !t.project_id || t.parent_id) continue;
        if ((t.status as string) === 'archived') continue;
        const entry = (map[t.project_id] ??= { taskCount: 0, doneCount: 0, hasActiveTask: false });
        entry.taskCount++;
        if (t.status === 'done') entry.doneCount++;
        const meta = (t.metadata ?? {}) as Record<string, unknown>;
        if (meta.active_session && t.status !== 'done') entry.hasActiveTask = true;
      }
      return map;
    },
  };

  // --- comments ---

  comments = {
    list: async (scope: WorkspaceScope, taskId: string): Promise<TaskComment[]> => {
      return this.commentRows.filter(
        (c) =>
          c.task_id === taskId &&
          (c as TaskComment & { workspace_id: string }).workspace_id === scope.workspaceId,
      );
    },
    add: async (scope: WorkspaceScope, input: CommentInput): Promise<TaskComment> => {
      this.taskInScope(scope, input.task_id);
      const comment = {
        id: nextId('comment'),
        task_id: input.task_id,
        author: input.author,
        content: input.content,
        user_id: input.user_id ?? null,
        created_at: this.now(),
        workspace_id: scope.workspaceId,
      };
      this.commentRows.push(comment);
      return comment;
    },
  };

  // --- attachments ---

  attachments = {
    list: async (scope: WorkspaceScope, taskId: string): Promise<TaskAttachment[]> => {
      return this.attachmentRows.filter(
        (a) =>
          a.task_id === taskId &&
          (a as TaskAttachment & { workspace_id: string }).workspace_id === scope.workspaceId,
      );
    },
    add: async (scope: WorkspaceScope, input: AttachmentInput): Promise<TaskAttachment> => {
      this.taskInScope(scope, input.task_id);
      const attachment = {
        id: nextId('attach'),
        ...input,
        created_at: this.now(),
        workspace_id: scope.workspaceId,
      };
      this.attachmentRows.push(attachment);
      return attachment;
    },
    remove: async (scope: WorkspaceScope, taskId: string, attachmentId: string): Promise<void> => {
      this.taskInScope(scope, taskId);
      const idx = this.attachmentRows.findIndex(
        (a) =>
          a.id === attachmentId &&
          a.task_id === taskId &&
          (a as TaskAttachment & { workspace_id: string }).workspace_id === scope.workspaceId,
      );
      if (idx >= 0) this.attachmentRows.splice(idx, 1);
    },
  };

  // --- activity ---

  activity = {
    append: async (scope: WorkspaceScope, entry: ActivityInput): Promise<ActivityEntry> => {
      const row: ActivityEntry = {
        id: nextId('activity'),
        event_type: entry.event_type,
        severity: entry.severity,
        source: entry.source ?? null,
        title: entry.title,
        details: entry.details ?? null,
        task_id: entry.task_id ?? null,
        agent_id: entry.agent_id ?? null,
        user_id: entry.user_id ?? null,
        actor_user_id: entry.actor_user_id ?? null,
        workspace_id: scope.workspaceId,
        created_at: this.now(),
        acknowledged_at: null,
      };
      this.activityRows.push(row);
      return row;
    },
    list: async (scope: WorkspaceScope, filter: ActivityListFilter = {}) => {
      let rows = this.activityRows.filter((a) => a.workspace_id === scope.workspaceId);
      if (filter.event_type) rows = rows.filter((a) => a.event_type === filter.event_type);
      if (filter.task_id) rows = rows.filter((a) => a.task_id === filter.task_id);
      if (filter.agent_id) rows = rows.filter((a) => a.agent_id === filter.agent_id);
      const total = rows.length;
      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? rows.length;
      return { data: rows.slice(offset, offset + limit), total };
    },
  };

  // --- agents ---

  agents = {
    upsertStatus: async (scope: WorkspaceScope, input: AgentStatusInput): Promise<void> => {
      const key = `${scope.workspaceId}:${input.agentName}`;
      const prev = this.agentRows.get(key);
      const now = this.now();
      this.agentRows.set(key, {
        id: prev?.id ?? nextId('agent'),
        agent_name: input.agentName,
        status: input.status,
        current_task_id: input.currentTaskId ?? null,
        model: prev?.model ?? null,
        uptime_start: prev?.uptime_start ?? null,
        last_heartbeat: now,
        metadata: prev?.metadata ?? null,
        user_id: input.userId ?? prev?.user_id ?? null,
        updated_at: now,
      });
    },
    listStatus: async (scope: WorkspaceScope): Promise<AgentStatus[]> => {
      return [...this.agentRows.entries()]
        .filter(([key]) => key.startsWith(`${scope.workspaceId}:`))
        .map(([, row]) => ({ ...row }));
    },
    appendHeartbeat: async (scope: WorkspaceScope, input: HeartbeatEventInput): Promise<void> => {
      if (!HEARTBEAT_TYPES.has(input.eventType)) {
        throw new Error(`heartbeat_events_event_type_check rejects ${input.eventType}`);
      }
      this.heartbeatRows.push({
        ...input,
        workspace_id: scope.workspaceId,
        created_at: this.now(),
      });
    },
  };

  // --- jobs ---

  private ownedBy(row: JobRow, claimant: Claimant): boolean {
    return 'keyId' in claimant
      ? row.claimed_by_key_id === claimant.keyId
      : row.worker_id === claimant.workerId;
  }

  jobs = {
    enqueue: async (scope: WorkspaceScope, row: Record<string, unknown>): Promise<JobRow> => {
      return this.seedJob(scope, row as Partial<JobRow>);
    },
    listPending: async (scope: WorkspaceScope, filter: PendingJobFilter): Promise<JobRow[]> => {
      const now = this.now();
      let rows = [...this.jobRows.values()].filter(
        (j) =>
          j.workspace_id === scope.workspaceId &&
          j.status === 'pending' &&
          j.queue_name === filter.queueName &&
          j.runner === filter.runner &&
          (j.retry_after == null || String(j.retry_after) <= now),
      );
      if (filter.jobTypes?.length)
        rows = rows.filter((j) => filter.jobTypes!.includes(String(j.job_type)));
      rows.sort(
        (a, b) =>
          Number(b.priority ?? 0) - Number(a.priority ?? 0) ||
          String(a.created_at).localeCompare(String(b.created_at)),
      );
      return rows.slice(0, filter.limit ?? 5).map((j) => ({ ...j }));
    },
    countPending: async (
      scope: WorkspaceScope,
      queueName: string,
      runner: JobRunner,
    ): Promise<number> => {
      return [...this.jobRows.values()].filter(
        (j) =>
          j.workspace_id === scope.workspaceId &&
          j.status === 'pending' &&
          j.queue_name === queueName &&
          j.runner === runner,
      ).length;
    },
    countActive: async (scope: WorkspaceScope, runner: JobRunner): Promise<number> => {
      return [...this.jobRows.values()].filter(
        (j) =>
          j.workspace_id === scope.workspaceId &&
          j.runner === runner &&
          ['pending', 'claimed', 'streaming'].includes(j.status),
      ).length;
    },
    list: async (
      scope: WorkspaceScope,
      filter: JobListFilter = {},
    ): Promise<{ rows: JobRow[]; total: number }> => {
      const rows = [...this.jobRows.values()]
        .filter(
          (j) =>
            j.workspace_id === scope.workspaceId &&
            (!filter.runner || j.runner === filter.runner) &&
            (!filter.statuses || filter.statuses.includes(j.status)) &&
            (!filter.targetType || j.target_type === filter.targetType) &&
            (!filter.targetId || j.target_id === filter.targetId),
        )
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 20;
      return {
        rows: rows.slice(offset, offset + limit).map((j) => ({ ...j })),
        total: rows.length,
      };
    },
    get: async (scope: WorkspaceScope, jobId: string): Promise<JobRow | null> => {
      const row = this.jobRows.get(jobId);
      return row && row.workspace_id === scope.workspaceId ? { ...row } : null;
    },
    claim: async (
      scope: WorkspaceScope,
      jobId: string,
      claimant: Claimant,
    ): Promise<JobRow | null> => {
      const row = this.jobRows.get(jobId);
      const runner = 'keyId' in claimant ? 'external' : 'server';
      if (
        !row ||
        row.workspace_id !== scope.workspaceId ||
        row.runner !== runner ||
        row.status !== 'pending'
      )
        return null;
      const now = this.now();
      const next = {
        ...row,
        status: 'claimed',
        claimed_by_key_id: 'keyId' in claimant ? claimant.keyId : null,
        worker_id: 'workerId' in claimant ? claimant.workerId : null,
        claimed_at: now,
        last_heartbeat_at: now,
      };
      this.jobRows.set(jobId, next);
      return { ...next };
    },
    heartbeat: async (
      scope: WorkspaceScope,
      jobId: string,
      claimant: Claimant,
      patch: Record<string, unknown>,
    ): Promise<JobRow | null> => {
      const row = this.jobRows.get(jobId);
      if (
        !row ||
        row.workspace_id !== scope.workspaceId ||
        !this.ownedBy(row, claimant) ||
        !['claimed', 'streaming'].includes(row.status)
      ) {
        return null;
      }
      const next = { ...row, ...patch } as JobRow;
      this.jobRows.set(jobId, next);
      return { ...next };
    },
    update: async (
      scope: WorkspaceScope,
      jobId: string,
      patch: Record<string, unknown>,
    ): Promise<void> => {
      const row = this.jobRows.get(jobId);
      if (!row || row.workspace_id !== scope.workspaceId) return;
      this.jobRows.set(jobId, { ...row, ...patch } as JobRow);
    },
    submitResult: async (
      scope: WorkspaceScope,
      jobId: string,
      patch: Record<string, unknown>,
    ): Promise<void> => {
      const row = this.jobRows.get(jobId);
      if (!row || row.workspace_id !== scope.workspaceId) return;
      if (!['claimed', 'streaming'].includes(row.status)) return;
      this.jobRows.set(jobId, { ...row, ...patch } as JobRow);
    },
    cancel: async (
      scope: WorkspaceScope,
      jobId: string,
      patch: Record<string, unknown>,
    ): Promise<JobRow | null> => {
      const row = this.jobRows.get(jobId);
      if (!row || row.workspace_id !== scope.workspaceId) return null;
      if (!['pending', 'claimed', 'streaming'].includes(row.status)) return null;
      const next = { ...row, ...patch } as JobRow;
      this.jobRows.set(jobId, next);
      return { ...next };
    },
    expire: async (scope: WorkspaceScope, staleBefore: string): Promise<number> => {
      let count = 0;
      for (const [id, row] of this.jobRows) {
        if (row.workspace_id !== scope.workspaceId) continue;
        if (!['claimed', 'streaming'].includes(row.status)) continue;
        if (String(row.last_heartbeat_at ?? '') < staleBefore) {
          this.jobRows.set(id, {
            ...row,
            status: 'pending',
            claimed_by_key_id: null,
            worker_id: null,
            claimed_at: null,
          });
          count++;
        }
      }
      return count;
    },
    appendLog: async (scope: WorkspaceScope, entry: JobLogInput): Promise<JobLogRow> => {
      const job = this.jobRows.get(entry.job_id);
      if (!job || job.workspace_id !== scope.workspaceId) throw new NotFound('Job', entry.job_id);
      const row: JobLogRow = {
        ...entry,
        id: nextId('log'),
        workspace_id: scope.workspaceId,
        created_at: this.now(),
      };
      this.jobLogRows.push(row);
      return { ...row };
    },
    listLogs: async (
      scope: WorkspaceScope,
      jobId: string,
      opts: { limit?: number; offset?: number } = {},
    ): Promise<JobLogRow[]> => {
      const rows = this.jobLogRows
        .filter((l) => l.workspace_id === scope.workspaceId && l.job_id === jobId)
        .sort((a, b) => a.step_index - b.step_index);
      const offset = opts.offset ?? 0;
      return rows.slice(offset, offset + (opts.limit ?? 50)).map((l) => ({ ...l }));
    },
  };

  // --- memory ---

  memory = {
    storeOutcome: async (scope: WorkspaceScope, input: OutcomeMemoryInput): Promise<void> => {
      this.memoryRows.push({ ...input, workspace_id: scope.workspaceId });
    },
  };

  // --- harness connections ---

  harnessConnections: HarnessConnectionStore = {
    get: async (scope: WorkspaceScope): Promise<HarnessConnection | null> => {
      const row = this.harnessConnectionRows.get(scope.workspaceId);
      return row ? structuredClone(row) : null;
    },
    upsert: async (
      scope: WorkspaceScope,
      input: HarnessConnectionInput,
    ): Promise<HarnessConnection> => {
      const row: HarnessConnection = {
        harness: input.harness,
        agents: { ...input.agents },
        config: structuredClone(input.config),
        createdBy: input.createdBy ?? null,
        updatedAt: this.now(),
      };
      this.harnessConnectionRows.set(scope.workspaceId, row);
      return structuredClone(row);
    },
    remove: async (scope: WorkspaceScope): Promise<boolean> =>
      this.harnessConnectionRows.delete(scope.workspaceId),
  };

  transaction<T>(fn: (store: Store) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
