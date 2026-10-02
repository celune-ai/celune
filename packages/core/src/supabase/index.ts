import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityEntry,
  AgentStatus,
  Project,
  Task,
  TaskAttachment,
  TaskComment,
} from '@repo/types';
import {
  createActivity,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  getActivity,
  getChildTasks,
  getProject,
  getProjectTaskCounts,
  getTask,
  reorderProjects,
  reorderTasks,
  updateProject,
  updateTask,
} from '@repo/db/queries';
import type { AttachmentBlobs } from '../attachments/attachment-service.ts';
import { NotFound, statusConflict, toStoreError } from '../errors.ts';
import { ACTIVE_RUN_STATUSES } from '../harness/types.ts';
import type { HarnessEventLedger } from '../harness/harness-service.ts';
import type { WorkspaceScope } from '../scope.ts';
import type {
  ActivityInput,
  ActivityListFilter,
  AgentStatusInput,
  AttachmentInput,
  CommentInput,
  Claimant,
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
  HarnessConnection,
  HarnessConnectionInput,
  HarnessConnectionStore,
  TaskCreateInput,
  TaskListFilter,
  TaskPatch,
  TaskUpdateOptions,
  TaskReorderItem,
} from '../store.ts';
import { ACTIVE_JOB_STATUSES } from '../store.ts';

const TASK_LIST_COLUMNS =
  'id, title, description, outcome, status, priority, assignee, project_id, user_id, org_id, workspace_id, category, due_date, source, source_ref, vault_path, time_estimate_minutes, time_spent_minutes, parent_id, spawned_by, context_keys, metadata, effort, depends_on, sort_order, created_at, updated_at, completed_at, archived_at';

const JOB_LIST_COLUMNS =
  'id, job_type, model, provider, runner, target_type, target_id, priority, created_at, estimated_tokens';

/** Columns safe to return to a UI: no encrypted payloads, no HMAC. */
const JOB_VIEW_COLUMNS =
  'id, workspace_id, org_id, requester_id, job_type, model, provider, runner, target_type, target_id, status, priority, attempt, max_attempts, claimed_by_key_id, worker_id, token_budget, tokens_used, start_to_close_ms, last_error, result_encrypted, result_iv, metadata, created_at, updated_at, claimed_at, started_at, completed_at, last_heartbeat_at';

/** The builder methods the task filter uses; the full Supabase generics are too deep to infer here. */
interface TaskQuery extends PromiseLike<{ data: unknown; count: number | null; error: unknown }> {
  neq(column: string, value: unknown): TaskQuery;
  eq(column: string, value: unknown): TaskQuery;
  is(column: string, value: null): TaskQuery;
  in(column: string, values: readonly unknown[]): TaskQuery;
}

function applyTaskFilter(query: unknown, filter: TaskListFilter): TaskQuery {
  let q = query as TaskQuery;
  if (!filter.includeArchived) q = q.neq('status', 'archived');
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.projectId) q = q.eq('project_id', filter.projectId);
  if (filter.assignee) q = q.eq('assignee', filter.assignee);
  if (filter.topLevelOnly) q = q.is('parent_id', null);
  if (filter.spawnedBy) q = q.eq('spawned_by', filter.spawnedBy);
  if (filter.ids) q = q.in('id', filter.ids);
  if (filter.activeHarnessRun) {
    q = q
      .eq('metadata->harness_run->>harness', filter.activeHarnessRun)
      .in('metadata->harness_run->>status', ACTIVE_RUN_STATUSES);
  }
  return q;
}

function claimantColumn(claimant: Claimant): [string, string] {
  return 'keyId' in claimant
    ? ['claimed_by_key_id', claimant.keyId]
    : ['worker_id', claimant.workerId];
}

function isNotFound(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST116' || (error.message ?? '').toLowerCase().includes('not found');
}

/**
 * Store over a service-role Supabase client. Every query carries the
 * workspace_id from the scope; tenancy does not rely on RLS here.
 */
export class SupabaseStore implements Store {
  private readonly client: SupabaseClient;

  readonly harnessEvents: HarnessEventLedger;
  readonly harnessConnections: HarnessConnectionStore;

  constructor(client: SupabaseClient) {
    this.client = client;
    this.harnessEvents = new SupabaseHarnessLedger(client);
    this.harnessConnections = new SupabaseHarnessConnections(client);
  }

  /**
   * Comments, attachments, and job logs hang off a parent row. Writing one
   * first checks the parent is in the scope's workspace, since task_attachments
   * has no workspace column and a foreign key alone accepts any tenant's id.
   */
  private async assertInScope(
    table: 'tasks' | 'ai_job_queue',
    scope: WorkspaceScope,
    id: string,
  ): Promise<void> {
    const { data, error } = await this.client
      .from(table)
      .select('id')
      .eq('id', id)
      .eq('workspace_id', scope.workspaceId)
      .maybeSingle();
    if (error && !isNotFound(error as { code?: string; message?: string })) {
      throw toStoreError(error);
    }
    if (!data) throw new NotFound(table === 'tasks' ? 'Task' : 'Job', id);
  }

  tasks = {
    list: async (scope: WorkspaceScope, filter: TaskListFilter = {}): Promise<Task[]> => {
      if (filter.ids?.length === 0) return [];
      const offset = filter.offset ?? 0;
      const query = applyTaskFilter(
        this.client
          .from('tasks')
          .select(TASK_LIST_COLUMNS)
          .eq('workspace_id', scope.workspaceId)
          .order('sort_order', { ascending: true })
          .range(offset, offset + (filter.limit ?? 2000) - 1),
        filter,
      );
      const { data, error } = await query;
      if (error) throw toStoreError(error);
      return (data ?? []) as unknown as Task[];
    },
    count: async (scope: WorkspaceScope, filter: TaskListFilter = {}): Promise<number> => {
      if (filter.ids?.length === 0) return 0;
      const query = applyTaskFilter(
        this.client
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', scope.workspaceId),
        filter,
      );
      const { count, error } = await query;
      if (error) throw toStoreError(error);
      return count ?? 0;
    },
    get: async (scope: WorkspaceScope, id: string): Promise<Task> => {
      try {
        return await getTask(this.client, id, scope.workspaceId);
      } catch (error) {
        if (isNotFound(error as { code?: string; message?: string }))
          throw new NotFound('Task', id);
        throw toStoreError(error);
      }
    },
    create: (scope: WorkspaceScope, input: TaskCreateInput): Promise<Task> => {
      return createTask(this.client, {
        ...(input as Partial<Task> & { title: string }),
        workspace_id: scope.workspaceId,
        ...(scope.orgId ? { org_id: scope.orgId } : {}),
      });
    },
    update: async (
      scope: WorkspaceScope,
      id: string,
      patch: TaskPatch,
      options: TaskUpdateOptions = {},
    ): Promise<Task> => {
      if (options.expectedStatus === undefined) {
        return updateTask(this.client, id, patch as Partial<Task>, scope.workspaceId);
      }
      const { data, error } = await this.client
        .from('tasks')
        .update(patch as Partial<Task>)
        .eq('id', id)
        .eq('workspace_id', scope.workspaceId)
        .eq('status', options.expectedStatus)
        .select()
        .maybeSingle();
      if (error) throw toStoreError(error);
      if (!data) throw statusConflict(id, options.expectedStatus);
      return data as Task;
    },
    delete: (scope: WorkspaceScope, id: string): Promise<void> => {
      return deleteTask(this.client, id, scope.workspaceId);
    },
    listChildren: (scope: WorkspaceScope, parentId: string): Promise<Task[]> => {
      return getChildTasks(this.client, parentId, scope.workspaceId);
    },
    replaceMetadataIfRun: async (
      scope: WorkspaceScope,
      id: string,
      expected: HarnessRunMarker,
      metadata: Record<string, unknown>,
    ): Promise<Task | null> => {
      let query = this.client
        .from('tasks')
        .update({ metadata })
        .eq('id', id)
        .eq('workspace_id', scope.workspaceId);
      query =
        expected.runId === null
          ? query.is('metadata->harness_run->>run_id', null)
          : query.eq('metadata->harness_run->>run_id', expected.runId);
      query =
        expected.lastEventId === null
          ? query.is('metadata->harness_run->>last_event_id', null)
          : query.eq('metadata->harness_run->>last_event_id', expected.lastEventId);
      const { data, error } = await query.select().maybeSingle();
      if (error) throw error;
      return (data as Task | null) ?? null;
    },
    listDependents: async (scope: WorkspaceScope, id: string): Promise<Task[]> => {
      const { data, error } = await this.client
        .from('tasks')
        .select(TASK_LIST_COLUMNS)
        .eq('workspace_id', scope.workspaceId)
        .contains('depends_on', [id])
        .limit(500);
      if (error) throw toStoreError(error);
      return (data ?? []) as unknown as Task[];
    },
    reorder: (scope: WorkspaceScope, items: TaskReorderItem[]): Promise<void> => {
      return reorderTasks(
        this.client,
        items.map((item) => ({
          id: item.id,
          status: item.status as Task['status'],
          sort_order: item.sort_order,
          workspace_id: scope.workspaceId,
        })),
      );
    },
  };

  projects = {
    list: async (scope: WorkspaceScope, filter: ProjectListFilter = {}): Promise<Project[]> => {
      if (filter.namePrefix !== undefined) {
        const escaped = filter.namePrefix.replace(/[%_]/g, '\\$&');
        const { data, error } = await this.client
          .from('projects')
          .select('id, name')
          .eq('workspace_id', scope.workspaceId)
          .ilike('name', `${escaped}%`)
          .limit(filter.limit ?? 100);
        if (error) throw toStoreError(error);
        return (data ?? []) as unknown as Project[];
      }
      const { data, error } = await this.client
        .from('projects')
        .select(
          'id, name, description, status, project_type, category, group_id, sort_order, metadata, workspace_id, user_id, created_at, updated_at',
        )
        .eq('workspace_id', scope.workspaceId)
        .order('sort_order', { ascending: true })
        .limit(filter.limit ?? 500);
      if (error) throw toStoreError(error);
      return (data ?? []) as unknown as Project[];
    },
    get: async (scope: WorkspaceScope, id: string): Promise<Project> => {
      try {
        return await getProject(this.client, id, scope.workspaceId);
      } catch (error) {
        if (isNotFound(error as { code?: string; message?: string }))
          throw new NotFound('Project', id);
        throw toStoreError(error);
      }
    },
    create: (scope: WorkspaceScope, input: ProjectCreateInput): Promise<Project> => {
      return createProject(this.client, {
        ...(input as Partial<Project> & { name: string }),
        workspace_id: scope.workspaceId,
        ...(scope.orgId ? { org_id: scope.orgId } : {}),
      });
    },
    update: (scope: WorkspaceScope, id: string, patch: ProjectPatch): Promise<Project> => {
      return updateProject(this.client, id, patch, scope.workspaceId);
    },
    delete: (scope: WorkspaceScope, id: string): Promise<void> => {
      return deleteProject(this.client, id, scope.workspaceId);
    },
    reorder: (scope: WorkspaceScope, items: ProjectReorderItem[]): Promise<void> => {
      return reorderProjects(
        this.client,
        items.map((item) => ({ ...item, workspace_id: scope.workspaceId })),
      );
    },
    groupExists: async (scope: WorkspaceScope, groupId: string): Promise<boolean> => {
      const { data, error } = await this.client
        .from('project_groups')
        .select('id')
        .eq('id', groupId)
        .eq('workspace_id', scope.workspaceId)
        .maybeSingle();
      if (error) throw toStoreError(error);
      return Boolean(data);
    },
    progress: (scope: WorkspaceScope): Promise<Record<string, ProjectProgress>> => {
      return getProjectTaskCounts(this.client, { workspace_id: scope.workspaceId });
    },
  };

  comments = {
    list: async (scope: WorkspaceScope, taskId: string): Promise<TaskComment[]> => {
      const { data, error } = await this.client
        .from('task_comments')
        .select('*')
        .eq('task_id', taskId)
        .eq('workspace_id', scope.workspaceId)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw toStoreError(error);
      return (data ?? []) as TaskComment[];
    },
    add: async (scope: WorkspaceScope, input: CommentInput): Promise<TaskComment> => {
      await this.assertInScope('tasks', scope, input.task_id);
      const { data, error } = await this.client
        .from('task_comments')
        .insert({
          task_id: input.task_id,
          author: input.author,
          content: input.content,
          ...(input.user_id ? { user_id: input.user_id } : {}),
          workspace_id: scope.workspaceId,
        })
        .select()
        .single();
      if (error) throw toStoreError(error);
      return data as TaskComment;
    },
  };

  // task_attachments has no workspace_id column; rows are scoped through
  // their task, and callers verify the task is in the workspace first.
  attachments = {
    list: async (scope: WorkspaceScope, taskId: string): Promise<TaskAttachment[]> => {
      const { data, error } = await this.client
        .from('task_attachments')
        .select(
          'id, task_id, file_name, file_size, mime_type, storage_path, uploaded_by, created_at, tasks!inner(workspace_id)',
        )
        .eq('task_id', taskId)
        .eq('tasks.workspace_id', scope.workspaceId)
        .order('created_at', { ascending: true });
      if (error) throw toStoreError(error);
      return ((data ?? []) as Array<TaskAttachment & { tasks?: unknown }>).map(
        ({ tasks: _task, ...row }) => row,
      );
    },
    add: async (scope: WorkspaceScope, input: AttachmentInput): Promise<TaskAttachment> => {
      await this.assertInScope('tasks', scope, input.task_id);
      const { data, error } = await this.client
        .from('task_attachments')
        .insert(input)
        .select(
          'id, task_id, file_name, file_size, mime_type, storage_path, uploaded_by, created_at',
        )
        .single();
      if (error) throw toStoreError(error);
      return data as TaskAttachment;
    },
    remove: async (scope: WorkspaceScope, taskId: string, attachmentId: string): Promise<void> => {
      await this.assertInScope('tasks', scope, taskId);
      const { error } = await this.client
        .from('task_attachments')
        .delete()
        .eq('id', attachmentId)
        .eq('task_id', taskId);
      if (error) throw toStoreError(error);
    },
  };

  activity = {
    append: (scope: WorkspaceScope, entry: ActivityInput): Promise<ActivityEntry> => {
      return createActivity(this.client, { ...entry, workspace_id: scope.workspaceId });
    },
    list: (scope: WorkspaceScope, filter: ActivityListFilter = {}) => {
      return getActivity(this.client, { ...filter, workspace_id: scope.workspaceId });
    },
  };

  agents = {
    upsertStatus: async (scope: WorkspaceScope, input: AgentStatusInput): Promise<void> => {
      const now = new Date().toISOString();
      const { error } = await this.client.from('agent_status').upsert(
        {
          workspace_id: scope.workspaceId,
          agent_name: input.agentName,
          status: input.status,
          current_task_id: input.currentTaskId ?? null,
          last_heartbeat: now,
          updated_at: now,
          ...(input.userId ? { user_id: input.userId } : {}),
        },
        { onConflict: 'workspace_id,agent_name' },
      );
      if (error) throw toStoreError(error);
    },
    listStatus: async (scope: WorkspaceScope): Promise<AgentStatus[]> => {
      const { data, error } = await this.client
        .from('agent_status')
        .select('*')
        .eq('workspace_id', scope.workspaceId)
        .order('agent_name', { ascending: true });
      if (error) throw toStoreError(error);
      return (data ?? []) as AgentStatus[];
    },
    appendHeartbeat: async (scope: WorkspaceScope, input: HeartbeatEventInput): Promise<void> => {
      const { error } = await this.client.from('heartbeat_events').insert({
        workspace_id: scope.workspaceId,
        agent_id: input.agentId,
        event_type: input.eventType,
        metadata: input.metadata ?? {},
      });
      if (error) throw toStoreError(error);
    },
  };

  jobs = {
    enqueue: async (scope: WorkspaceScope, row: Record<string, unknown>): Promise<JobRow> => {
      const { data, error } = await this.client
        .from('ai_job_queue')
        .insert({ ...row, workspace_id: scope.workspaceId })
        .select('id, status, job_type, runner, created_at')
        .single();
      if (error) throw toStoreError(error);
      return data as JobRow;
    },
    listPending: async (scope: WorkspaceScope, filter: PendingJobFilter): Promise<JobRow[]> => {
      let query = this.client
        .from('ai_job_queue')
        .select(JOB_LIST_COLUMNS)
        .eq('workspace_id', scope.workspaceId)
        .eq('status', 'pending')
        .eq('queue_name', filter.queueName)
        .eq('runner', filter.runner)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(filter.limit ?? 5);
      if (filter.jobTypes?.length) query = query.in('job_type', filter.jobTypes);
      query = query.or('retry_after.is.null,retry_after.lte.' + new Date().toISOString());
      const { data, error } = await query;
      if (error) throw toStoreError(error);
      return (data ?? []) as unknown as JobRow[];
    },
    countPending: async (
      scope: WorkspaceScope,
      queueName: string,
      runner: JobRunner,
    ): Promise<number> => {
      const { count, error } = await this.client
        .from('ai_job_queue')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', scope.workspaceId)
        .eq('status', 'pending')
        .eq('queue_name', queueName)
        .eq('runner', runner);
      if (error) throw toStoreError(error);
      return count ?? 0;
    },
    countActive: async (scope: WorkspaceScope, runner: JobRunner): Promise<number> => {
      const { count, error } = await this.client
        .from('ai_job_queue')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', scope.workspaceId)
        .eq('runner', runner)
        .in('status', [...ACTIVE_JOB_STATUSES]);
      if (error) throw toStoreError(error);
      return count ?? 0;
    },
    list: async (
      scope: WorkspaceScope,
      filter: JobListFilter = {},
    ): Promise<{ rows: JobRow[]; total: number }> => {
      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 20;
      let query = this.client
        .from('ai_job_queue')
        .select(JOB_VIEW_COLUMNS, { count: 'exact' })
        .eq('workspace_id', scope.workspaceId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (filter.runner) query = query.eq('runner', filter.runner);
      if (filter.statuses?.length) query = query.in('status', filter.statuses);
      if (filter.targetType) query = query.eq('target_type', filter.targetType);
      if (filter.targetId) query = query.eq('target_id', filter.targetId);
      const { data, error, count } = await query;
      if (error) throw toStoreError(error);
      return { rows: (data ?? []) as unknown as JobRow[], total: count ?? 0 };
    },
    get: async (scope: WorkspaceScope, jobId: string, columns = '*'): Promise<JobRow | null> => {
      const { data, error } = await this.client
        .from('ai_job_queue')
        .select(columns)
        .eq('id', jobId)
        .eq('workspace_id', scope.workspaceId)
        .maybeSingle();
      if (error) throw toStoreError(error);
      return (data as unknown as JobRow | null) ?? null;
    },
    claim: async (
      scope: WorkspaceScope,
      jobId: string,
      claimant: Claimant,
      columns = '*',
    ): Promise<JobRow | null> => {
      const now = new Date().toISOString();
      const { data, error } = await this.client
        .from('ai_job_queue')
        .update({
          status: 'claimed',
          claimed_by_key_id: 'keyId' in claimant ? claimant.keyId : null,
          worker_id: 'workerId' in claimant ? claimant.workerId : null,
          claimed_at: now,
          last_heartbeat_at: now,
        })
        .eq('id', jobId)
        .eq('workspace_id', scope.workspaceId)
        .eq('runner', 'keyId' in claimant ? 'external' : 'server')
        .eq('status', 'pending')
        .select(columns)
        .maybeSingle();
      if (error) throw toStoreError(error);
      return (data as unknown as JobRow | null) ?? null;
    },
    heartbeat: async (
      scope: WorkspaceScope,
      jobId: string,
      claimant: Claimant,
      patch: Record<string, unknown>,
    ): Promise<JobRow | null> => {
      const { data, error } = await this.client
        .from('ai_job_queue')
        .update(patch)
        .eq('id', jobId)
        .eq('workspace_id', scope.workspaceId)
        .eq(...claimantColumn(claimant))
        .in('status', ['claimed', 'streaming'])
        .select('id, status, metadata')
        .maybeSingle();
      if (error) throw toStoreError(error);
      return (data as unknown as JobRow | null) ?? null;
    },
    update: async (
      scope: WorkspaceScope,
      jobId: string,
      patch: Record<string, unknown>,
    ): Promise<void> => {
      const { error } = await this.client
        .from('ai_job_queue')
        .update(patch)
        .eq('id', jobId)
        .eq('workspace_id', scope.workspaceId);
      if (error) throw toStoreError(error);
    },
    submitResult: async (
      scope: WorkspaceScope,
      jobId: string,
      patch: Record<string, unknown>,
    ): Promise<void> => {
      const { error } = await this.client
        .from('ai_job_queue')
        .update(patch)
        .eq('id', jobId)
        .eq('workspace_id', scope.workspaceId)
        .in('status', ['claimed', 'streaming']);
      if (error) throw toStoreError(error);
    },
    cancel: async (
      scope: WorkspaceScope,
      jobId: string,
      patch: Record<string, unknown>,
    ): Promise<JobRow | null> => {
      const { data, error } = await this.client
        .from('ai_job_queue')
        .update(patch)
        .eq('id', jobId)
        .eq('workspace_id', scope.workspaceId)
        .in('status', [...ACTIVE_JOB_STATUSES])
        .select(JOB_VIEW_COLUMNS)
        .maybeSingle();
      if (error) throw toStoreError(error);
      return (data as unknown as JobRow | null) ?? null;
    },
    expire: async (scope: WorkspaceScope, staleBefore: string): Promise<number> => {
      const { data, error } = await this.client
        .from('ai_job_queue')
        .update({ status: 'pending', claimed_by_key_id: null, worker_id: null, claimed_at: null })
        .eq('workspace_id', scope.workspaceId)
        .in('status', ['claimed', 'streaming'])
        .lt('last_heartbeat_at', staleBefore)
        .select('id');
      if (error) throw toStoreError(error);
      return data?.length ?? 0;
    },
    appendLog: async (scope: WorkspaceScope, entry: JobLogInput): Promise<JobLogRow> => {
      await this.assertInScope('ai_job_queue', scope, entry.job_id);
      const { data, error } = await this.client
        .from('job_logs')
        .insert({
          job_id: entry.job_id,
          workspace_id: scope.workspaceId,
          step_index: entry.step_index,
          event_type: entry.event_type,
          content: entry.content ?? null,
          tool_name: entry.tool_name ?? null,
          tool_input: entry.tool_input ?? null,
          tool_result: entry.tool_result ?? null,
          input_tokens: entry.input_tokens ?? 0,
          output_tokens: entry.output_tokens ?? 0,
          metadata: entry.metadata ?? {},
        })
        .select()
        .single();
      if (error) throw toStoreError(error);
      return data as JobLogRow;
    },
    listLogs: async (
      scope: WorkspaceScope,
      jobId: string,
      opts: { limit?: number; offset?: number } = {},
    ): Promise<JobLogRow[]> => {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      const { data, error } = await this.client
        .from('job_logs')
        .select('*')
        .eq('workspace_id', scope.workspaceId)
        .eq('job_id', jobId)
        .order('step_index', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw toStoreError(error);
      return (data ?? []) as JobLogRow[];
    },
  };

  memory = {
    storeOutcome: async (scope: WorkspaceScope, input: OutcomeMemoryInput): Promise<void> => {
      const { error } = await this.client.from('agent_memory').insert({
        key: `task-outcome:${input.taskId}`,
        content: `Task "${input.title}" completed. Outcome: ${input.outcome}`,
        category: 'fact',
        memory_type: 'episode',
        source: input.source,
        ...(input.userId ? { user_id: input.userId } : {}),
        org_id: scope.orgId,
        workspace_id: scope.workspaceId,
      });
      if (error) throw toStoreError(error);
    },
  };

  transaction<T>(fn: (store: Store) => Promise<T>): Promise<T> {
    // PostgREST has no client-side transactions; callers get the same store.
    return fn(this);
  }
}

export const ATTACHMENT_BUCKET = 'task-attachments';

/** Attachment bytes in a Supabase Storage bucket; paths start with the task id. */
/** Harness event dedupe on the harness_event_ledger primary key (workspace_id, event_id). */
export class SupabaseHarnessLedger implements HarnessEventLedger {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async take(scope: WorkspaceScope, eventId: string): Promise<boolean> {
    const { error } = await this.client
      .from('harness_event_ledger')
      .insert({ workspace_id: scope.workspaceId, event_id: eventId });
    if (!error) return true;
    if (error.code === '23505') return false;
    throw error;
  }

  async release(scope: WorkspaceScope, eventId: string): Promise<void> {
    const { error } = await this.client
      .from('harness_event_ledger')
      .delete()
      .eq('workspace_id', scope.workspaceId)
      .eq('event_id', eventId);
    if (error) throw error;
  }
}

const HARNESS_CONNECTION_COLUMNS = 'harness, agents, config, created_by, updated_at';

function toHarnessConnection(row: Record<string, unknown>): HarnessConnection {
  return {
    harness: row.harness as string,
    agents: (row.agents ?? {}) as Record<string, string>,
    config: (row.config ?? {}) as Record<string, unknown>,
    createdBy: (row.created_by as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

/** One harness_connections row per workspace; the primary key is workspace_id. */
export class SupabaseHarnessConnections implements HarnessConnectionStore {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async get(scope: WorkspaceScope): Promise<HarnessConnection | null> {
    const { data, error } = await this.client
      .from('harness_connections')
      .select(HARNESS_CONNECTION_COLUMNS)
      .eq('workspace_id', scope.workspaceId)
      .maybeSingle();
    if (error) throw toStoreError(error);
    return data ? toHarnessConnection(data) : null;
  }

  async upsert(scope: WorkspaceScope, input: HarnessConnectionInput): Promise<HarnessConnection> {
    const { data, error } = await this.client
      .from('harness_connections')
      .upsert(
        {
          workspace_id: scope.workspaceId,
          org_id: scope.orgId,
          harness: input.harness,
          agents: input.agents,
          config: input.config,
          created_by: input.createdBy ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id' },
      )
      .select(HARNESS_CONNECTION_COLUMNS)
      .single();
    if (error) throw toStoreError(error);
    return toHarnessConnection(data);
  }

  async remove(scope: WorkspaceScope): Promise<boolean> {
    const { data, error } = await this.client
      .from('harness_connections')
      .delete()
      .eq('workspace_id', scope.workspaceId)
      .select('workspace_id');
    if (error) throw toStoreError(error);
    return (data ?? []).length > 0;
  }
}

export class SupabaseAttachmentBlobs implements AttachmentBlobs {
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor(client: SupabaseClient, bucket: string = ATTACHMENT_BUCKET) {
    this.client = client;
    this.bucket = bucket;
  }

  async put(_scope: WorkspaceScope, path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await this.client.storage.from(this.bucket).upload(path, bytes, {
      contentType,
    });
    if (error) throw toStoreError(error);
  }

  async remove(_scope: WorkspaceScope, path: string) {
    const { error } = await this.client.storage.from(this.bucket).remove([path]);
    if (error) throw toStoreError(error);
  }

  async signedUrl(_scope: WorkspaceScope, path: string, expiresInSeconds: number) {
    const { data } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresInSeconds);
    return data?.signedUrl ?? null;
  }
}
