import type { Task, TaskMetadata } from '@repo/types';
import type { ActorContext } from '../actor.ts';
import { Conflict, GateDenied, NotFound, TaskBlocked, ValidationError } from '../errors.ts';
import { NoopGate, type Gate } from '../gate.ts';
import { isUuid, type WorkspaceScope } from '../scope.ts';
import type {
  CommentInput,
  Store,
  TaskCreateInput,
  TaskListFilter,
  TaskLifecycleStatus,
  TaskPatch,
  TaskReorderItem,
  TaskUpdateOptions,
} from '../store.ts';
import { validateDependencies } from './dependencies.ts';
import { assertTransition, isLifecycleStatus, transitionPath } from './transitions.ts';

// Callers cannot move a task between tenants or rewrite its id through a patch
const SCOPE_KEYS: ReadonlySet<string> = new Set(['id', 'workspace_id', 'org_id']);

type Meta = TaskMetadata & Record<string, unknown>;

const PIV_STAGE: Partial<Record<TaskLifecycleStatus, string>> = {
  planning: 'plan',
  in_progress: 'implement',
  review: 'validate',
  done: 'validate',
};

/** Statuses a claim walks through planning first. */
const PRE_PLANNING: TaskLifecycleStatus[] = ['backlog', 'inbox', 'scoping'];

/**
 * A claim lost its compare-and-set. The same agent claiming twice at once is a retry whose claim
 * already landed, so it gets the current task; every other loser gets the Conflict.
 */
function claimRetryOrThrow(current: Task, agentId: string, conflict: Conflict): Task {
  if (statusOf(current) === 'in_progress' && metaOf(current).claimed_by === agentId) return current;
  throw conflict;
}

export interface TaskServiceOptions {
  gate?: Gate;
  clock?: () => Date;
}

export interface TaskUpdateResult {
  task: Task;
  previous: Task;
  statusChanged: boolean;
  completed: boolean;
}

export interface CompleteInput {
  agentId?: string | null;
  outcome?: string | null;
}

export interface BlockInput {
  reason: string;
  agentId?: string | null;
}

export interface TaskChildren {
  children: Task[];
  /** True when every child is done or archived (also true with no children). */
  allComplete: boolean;
}

export interface InitiateResult extends TaskUpdateResult {
  agentId: string;
}

/** Agent that picks up an initiated task nobody is assigned to. */
export const DEFAULT_INITIATE_AGENT = 'rick';

export interface AddCommentInput {
  author: string;
  content: string;
  userId?: string | null;
}

function metaOf(task: Task): Meta {
  return { ...((task.metadata ?? {}) as Meta) };
}

function statusOf(task: Task): TaskLifecycleStatus {
  return task.status as TaskLifecycleStatus;
}

export class TaskService {
  private readonly store: Store;
  private readonly gate: Gate;
  private readonly clock: () => Date;

  constructor(store: Store, options: TaskServiceOptions = {}) {
    this.store = store;
    this.gate = options.gate ?? new NoopGate();
    this.clock = options.clock ?? (() => new Date());
  }

  list(scope: WorkspaceScope, filter?: TaskListFilter): Promise<Task[]> {
    return this.store.tasks.list(scope, filter);
  }

  get(scope: WorkspaceScope, id: string): Promise<Task> {
    return this.store.tasks.get(scope, id);
  }

  count(scope: WorkspaceScope, filter?: TaskListFilter): Promise<number> {
    return this.store.tasks.count(scope, filter);
  }

  /** The tasks this one depends on, in the same workspace. */
  async dependencies(scope: WorkspaceScope, id: string): Promise<Task[]> {
    const task = await this.store.tasks.get(scope, id);
    const ids = task.depends_on ?? [];
    if (ids.length === 0) return [];
    return this.store.tasks.list(scope, { ids, includeArchived: true });
  }

  async children(scope: WorkspaceScope, id: string): Promise<TaskChildren> {
    await this.store.tasks.get(scope, id);
    const children = await this.store.tasks.listChildren(scope, id);
    const allComplete = children.every((c) => c.status === 'done' || statusOf(c) === 'archived');
    return { children, allComplete };
  }

  /** Follow-up tasks created from this one. */
  async spawned(scope: WorkspaceScope, id: string): Promise<Task[]> {
    await this.store.tasks.get(scope, id);
    return this.store.tasks.list(scope, { spawnedBy: id, includeArchived: true, limit: 500 });
  }

  /**
   * Board drag and drop: writes sort order and column for many tasks at once.
   * A drop may skip lifecycle steps, so transitions are not validated here; the
   * activity row, completion stamps, and claimer reset still apply.
   * Returns the tasks whose status changed.
   */
  async reorder(
    scope: WorkspaceScope,
    items: TaskReorderItem[],
    actor: ActorContext,
  ): Promise<TaskUpdateResult[]> {
    if (items.length === 0) return [];
    for (const item of items) {
      if (!isLifecycleStatus(item.status)) {
        throw new ValidationError(`Unknown status: ${String(item.status)}`);
      }
    }
    const ids = [...new Set(items.map((item) => item.id))];
    const before = await this.store.tasks.list(scope, { ids, includeArchived: true });
    const previous = new Map(before.map((t) => [t.id, t]));
    const missing = ids.find((id) => !previous.has(id));
    if (missing) throw new NotFound('Task', missing);

    await this.store.tasks.reorder(scope, items);

    const now = this.clock().toISOString();
    const moved = items.filter((item) => statusOf(previous.get(item.id) as Task) !== item.status);
    const changed: TaskUpdateResult[] = [];
    for (const item of moved) {
      const pre = previous.get(item.id) as Task;
      const meta = metaOf(pre);
      const agentId =
        meta.claimed_by ?? (pre.assignee && pre.assignee !== 'unassigned' ? pre.assignee : null);
      await this.store.activity.append(scope, {
        event_type: 'task.updated',
        severity: 'info',
        source: actor.source,
        title: `Task status changed: ${pre.status} → ${item.status}`,
        task_id: pre.id,
        agent_id: agentId,
        actor_user_id: actor.userId ?? null,
        user_id: actor.ownerUserId ?? null,
        details: { task_id: pre.id, previous_status: pre.status, new_status: item.status },
      });

      const movingToDone = item.status === 'done';
      if (movingToDone && meta.active_session) {
        await this.store.tasks.update(scope, pre.id, {
          metadata: {
            ...meta,
            active_session: false,
            completed_by: meta.claimed_by ?? pre.assignee,
            work_completed_at: now,
          },
          completed_at: now,
        });
        if (meta.claimed_by) {
          await this.store.agents.upsertStatus(scope, {
            agentName: meta.claimed_by,
            status: 'online',
            currentTaskId: null,
            userId: actor.ownerUserId ?? null,
          });
        }
      } else if (movingToDone && !pre.completed_at) {
        await this.store.tasks.update(scope, pre.id, { completed_at: now });
      }
      const task = await this.store.tasks.get(scope, pre.id);
      changed.push({ task, previous: pre, statusChanged: true, completed: movingToDone });
    }
    return changed;
  }

  /**
   * Starts work on a task from the UI: assigns an agent (the default agent when
   * unassigned), walks the status to in_progress, marks the session active, and
   * records the agent as working. Queuing a run is the caller's job.
   */
  async initiate(
    scope: WorkspaceScope,
    id: string,
    actor: ActorContext,
    options: { defaultAgent?: string } = {},
  ): Promise<InitiateResult> {
    const original = await this.store.tasks.get(scope, id);
    if (original.status === 'done') {
      throw new ValidationError('Cannot initiate a completed task');
    }
    const agentId =
      !original.assignee || original.assignee === 'unassigned'
        ? (options.defaultAgent ?? DEFAULT_INITIATE_AGENT)
        : original.assignee;
    const hopActor = { ...actor, agentId };

    let existing = original;
    if (PRE_PLANNING.includes(statusOf(existing))) {
      const hop = await this.applyUpdate(
        scope,
        existing,
        { status: 'planning' },
        hopActor,
        'task.updated',
      );
      existing = hop.task;
    }

    const now = this.clock().toISOString();
    const title = `Task initiated: ${original.title}`;
    const result = await this.applyUpdate(
      scope,
      existing,
      {
        status: 'in_progress',
        assignee: agentId as Task['assignee'],
        metadata: {
          ...metaOf(existing),
          initiated: true,
          initiated_at: now,
          initiated_by: actor.userId ?? 'system',
          active_session: true,
          active_since: now,
          claimed_by: agentId,
          pre_initiate_status: original.status,
        },
      },
      hopActor,
      'task.initiated',
      { title },
    );
    if (!result.statusChanged) {
      await this.store.activity.append(scope, {
        event_type: 'task.initiated',
        severity: 'info',
        source: actor.source,
        title,
        task_id: id,
        agent_id: agentId,
        actor_user_id: actor.userId ?? null,
        user_id: actor.ownerUserId ?? null,
        details: { task_id: id },
      });
    }

    await this.store.agents.upsertStatus(scope, {
      agentName: agentId,
      status: 'working',
      currentTaskId: id,
      userId: actor.ownerUserId ?? null,
    });
    await this.store.agents.appendHeartbeat(scope, {
      agentId,
      eventType: 'task_started',
      metadata: { task_id: id, task_title: original.title },
    });

    return { ...result, previous: original, agentId };
  }

  async create(scope: WorkspaceScope, input: TaskCreateInput, actor: ActorContext): Promise<Task> {
    const verdict = await this.gate.check('task.create', { scope, userId: actor.userId });
    if (!verdict.allowed) {
      throw new GateDenied('task.create', verdict.reason, {
        status: verdict.status,
        upgradeUrl: verdict.upgradeUrl,
        details: verdict.details,
      });
    }

    if (input.status !== undefined && !isLifecycleStatus(input.status)) {
      throw new ValidationError(`Unknown status: ${String(input.status)}`);
    }

    await this.assertReferencesInScope(scope, input, null);

    if (input.depends_on && input.depends_on.length > 0) {
      await validateDependencies(this.store.tasks, scope, null, input.depends_on);
    }

    const task = await this.store.tasks.create(scope, input);

    const spawnedByIsUuid = Boolean(input.spawned_by && isUuid(input.spawned_by));
    const eventType = input.parent_id
      ? 'task.spawned'
      : spawnedByIsUuid
        ? 'task.follow_up'
        : 'task.created';
    const agentId = spawnedByIsUuid
      ? (input.assignee ?? actor.agentId ?? null)
      : (input.spawned_by ?? input.assignee ?? actor.agentId ?? null);
    const source = spawnedByIsUuid
      ? 'follow-up'
      : (input.source ?? input.spawned_by ?? actor.source);

    await this.store.activity.append(scope, {
      event_type: eventType,
      severity: 'info',
      source,
      title: input.parent_id
        ? `Child task spawned: ${task.title}`
        : spawnedByIsUuid
          ? `Follow-up task created: ${task.title}`
          : `Task created: ${task.title}`,
      task_id: task.id,
      agent_id: agentId,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
      details: { task_id: task.id, assignee: task.assignee, status: task.status },
    });

    return task;
  }

  /** General patch. A status in the patch goes through the transition validator. */
  async update(
    scope: WorkspaceScope,
    id: string,
    patch: TaskPatch,
    actor: ActorContext,
  ): Promise<TaskUpdateResult> {
    const existing = await this.store.tasks.get(scope, id);
    return this.applyUpdate(scope, existing, patch, actor, 'task.updated');
  }

  /** The one public path that changes status on purpose. */
  updateStatus(
    scope: WorkspaceScope,
    id: string,
    status: TaskLifecycleStatus,
    actor: ActorContext,
    extra: Omit<TaskPatch, 'status'> = {},
  ): Promise<TaskUpdateResult> {
    return this.update(scope, id, { ...extra, status }, actor);
  }

  async claim(
    scope: WorkspaceScope,
    id: string,
    agentId: string,
    actor: ActorContext,
  ): Promise<Task> {
    let existing = await this.store.tasks.get(scope, id);
    const meta = metaOf(existing);
    if (meta.blocked) {
      throw new TaskBlocked(id, meta.blocked_reason);
    }

    // Fresh tasks reach in_progress through planning; both hops are validated and logged.
    if (PRE_PLANNING.includes(statusOf(existing))) {
      try {
        const hop = await this.applyUpdate(
          scope,
          existing,
          { status: 'planning' },
          actor,
          'task.updated',
          {},
          { expectedStatus: statusOf(existing) },
        );
        existing = hop.task;
      } catch (error) {
        if (!(error instanceof Conflict)) throw error;
        const current = await this.store.tasks.get(scope, id);
        // Another claim moved it to planning first; both now race the in_progress write below.
        if (statusOf(current) !== 'planning' || metaOf(current).blocked) {
          return claimRetryOrThrow(current, agentId, error);
        }
        existing = current;
      }
    }

    const now = this.clock().toISOString();
    const prevAssignee = existing.assignee;
    const isDelegation =
      Boolean(prevAssignee) && prevAssignee !== 'unassigned' && prevAssignee !== agentId;
    const metadata: Meta = {
      ...metaOf(existing),
      active_session: true,
      active_since: now,
      claimed_at: now,
      claimed_by: agentId,
      ...(isDelegation ? { delegated_by: prevAssignee, delegated_at: now } : {}),
    };

    let result: TaskUpdateResult;
    try {
      result = await this.applyUpdate(
        scope,
        existing,
        { status: 'in_progress', assignee: agentId as Task['assignee'], metadata },
        { ...actor, agentId },
        'task.claimed',
        { title: `${agentId} claimed: ${existing.title}` },
        // Two claims that read the same status cannot both write; the second gets Conflict.
        { expectedStatus: statusOf(existing) },
      );
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
      return claimRetryOrThrow(await this.store.tasks.get(scope, id), agentId, error);
    }

    await this.store.agents.upsertStatus(scope, {
      agentName: agentId,
      status: 'working',
      currentTaskId: id,
      userId: actor.ownerUserId ?? null,
    });

    return result.task;
  }

  async complete(
    scope: WorkspaceScope,
    id: string,
    input: CompleteInput,
    actor: ActorContext,
  ): Promise<Task> {
    const existing = await this.store.tasks.get(scope, id);
    const meta = metaOf(existing);
    const agentId = input.agentId ?? meta.claimed_by ?? actor.agentId ?? null;
    const outcome = input.outcome?.trim() ? input.outcome.trim() : undefined;

    const patch: TaskPatch = {
      status: 'done',
      ...(outcome !== undefined ? { outcome } : {}),
      ...(agentId ? { metadata: { ...meta, completed_by: agentId } } : {}),
    };

    const result = await this.applyUpdate(
      scope,
      existing,
      patch,
      { ...actor, agentId },
      'task.completed',
      { title: `${agentId ?? 'Task'} completed: ${existing.title}` },
    );

    // applyUpdate already reset the claimer; cover an explicit agent that never claimed.
    if (agentId && agentId !== meta.claimed_by) {
      await this.store.agents.upsertStatus(scope, {
        agentName: agentId,
        status: 'online',
        currentTaskId: null,
        userId: actor.ownerUserId ?? null,
      });
    }

    // The task is already done; a failed memory write (a full quota, say) must not report it as failed.
    if (outcome && this.store.memory) {
      await this.store.memory
        .storeOutcome(scope, {
          taskId: id,
          title: result.task.title,
          outcome,
          source: actor.source,
          userId: actor.userId ?? null,
        })
        .catch(() => undefined);
    }

    return result.task;
  }

  async block(
    scope: WorkspaceScope,
    id: string,
    input: BlockInput,
    actor: ActorContext,
  ): Promise<Task> {
    const existing = await this.store.tasks.get(scope, id);
    const now = this.clock().toISOString();
    const agentId = input.agentId ?? actor.agentId ?? null;
    const metadata: Meta = {
      ...metaOf(existing),
      blocked: true,
      blocked_at: now,
      blocked_reason: input.reason,
      ...(agentId ? { blocked_by: agentId } : {}),
    };
    const task = await this.store.tasks.update(scope, id, { metadata });
    await this.store.activity.append(scope, {
      event_type: 'task.blocked',
      severity: 'warning',
      source: actor.source,
      title: `${agentId ?? 'Task'} blocked: ${existing.title}`,
      task_id: id,
      agent_id: agentId,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
      details: { task_id: id, reason: input.reason },
    });
    return task;
  }

  async unblock(scope: WorkspaceScope, id: string, actor: ActorContext): Promise<Task> {
    const existing = await this.store.tasks.get(scope, id);
    const metadata = metaOf(existing);
    delete metadata.blocked;
    delete metadata.blocked_at;
    delete metadata.blocked_reason;
    delete metadata.blocked_by;
    const task = await this.store.tasks.update(scope, id, { metadata });
    await this.store.activity.append(scope, {
      event_type: 'task.unblocked',
      severity: 'info',
      source: actor.source,
      title: `Unblocked: ${existing.title}`,
      task_id: id,
      agent_id: actor.agentId ?? null,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
      details: { task_id: id },
    });
    return task;
  }

  async addComment(scope: WorkspaceScope, id: string, input: AddCommentInput, actor: ActorContext) {
    await this.store.tasks.get(scope, id);
    const payload: CommentInput = {
      task_id: id,
      author: input.author,
      content: input.content,
      user_id: input.userId ?? actor.userId ?? null,
    };
    const comment = await this.store.comments.add(scope, payload);
    await this.store.activity.append(scope, {
      event_type: 'task.commented',
      severity: 'info',
      source: actor.source,
      title: `${input.author} commented on task`,
      task_id: id,
      agent_id: actor.agentId ?? null,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
      details: { task_id: id, author: input.author, comment_id: comment.id },
    });
    return comment;
  }

  async delete(scope: WorkspaceScope, id: string, actor: ActorContext): Promise<void> {
    const task = await this.store.tasks.get(scope, id);
    const meta = metaOf(task);
    await this.store.activity.append(scope, {
      event_type: 'task.deleted',
      severity: 'info',
      source: actor.source,
      title: `Task deleted: ${task.title}`,
      task_id: id,
      agent_id: meta.claimed_by ?? task.assignee ?? null,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
    });
    await this.store.tasks.delete(scope, id);
  }

  validateDependencies(scope: WorkspaceScope, taskId: string | null, dependsOn: string[]) {
    return validateDependencies(this.store.tasks, scope, taskId, dependsOn);
  }

  /** Path a status change would take, for callers that want to explain a refusal. */
  transitionPath(from: TaskLifecycleStatus, to: TaskLifecycleStatus) {
    return transitionPath(from, to);
  }

  // --- internals ---

  /**
   * Linked project, parent, and follow-up origin must live in the caller's
   * workspace. The scoped lookups throw NotFound for ids in other workspaces.
   */
  private async assertReferencesInScope(
    scope: WorkspaceScope,
    refs: { project_id?: string | null; parent_id?: string | null; spawned_by?: string | null },
    taskId: string | null,
  ): Promise<void> {
    if (refs.project_id) {
      await this.store.projects.get(scope, refs.project_id);
    }
    if (refs.parent_id) {
      if (taskId && refs.parent_id === taskId) {
        throw new ValidationError('A task cannot be its own parent');
      }
      const parent = await this.store.tasks.get(scope, refs.parent_id);
      if (parent.parent_id) {
        throw new ValidationError('Cannot nest deeper than one level');
      }
    }
    if (refs.spawned_by && isUuid(refs.spawned_by)) {
      await this.store.tasks.get(scope, refs.spawned_by);
    }
  }

  private async applyUpdate(
    scope: WorkspaceScope,
    existing: Task,
    patch: TaskPatch,
    actor: ActorContext,
    eventType: string,
    activity: { title?: string } = {},
    storeOptions: TaskUpdateOptions = {},
  ): Promise<TaskUpdateResult> {
    const fromStatus = statusOf(existing);
    const toStatus = patch.status;
    if (toStatus !== undefined && !isLifecycleStatus(toStatus)) {
      throw new ValidationError(`Unknown status: ${String(toStatus)}`);
    }
    const statusChanged = toStatus !== undefined && toStatus !== fromStatus;
    if (statusChanged) {
      assertTransition(fromStatus, toStatus);
    }
    const movingToDone = statusChanged && toStatus === 'done';
    const now = this.clock().toISOString();
    const existingMeta = metaOf(existing);

    await this.assertReferencesInScope(scope, patch, existing.id);

    if (patch.depends_on !== undefined) {
      await validateDependencies(this.store.tasks, scope, existing.id, patch.depends_on);
    }

    let metadata: Meta | undefined = patch.metadata
      ? { ...existingMeta, ...(patch.metadata as Meta) }
      : undefined;

    if (statusChanged) {
      const stage = PIV_STAGE[toStatus];
      if (stage) {
        metadata = { ...(metadata ?? existingMeta), piv_stage: stage, [`piv_${stage}_at`]: now };
      }
    }

    let completedAt = patch.completed_at;
    if (movingToDone) {
      const base = metadata ?? existingMeta;
      const explicitCompletedBy = (patch.metadata as Meta | undefined)?.completed_by;
      metadata = {
        ...base,
        active_session: false,
        active_since: undefined,
        completed_by: explicitCompletedBy ?? existingMeta.claimed_by ?? existing.assignee,
        work_completed_at: now,
      };
      if (!completedAt) completedAt = now;
    }

    const dbPatch: TaskPatch = {};
    for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
      if (key === 'metadata' || key === 'completed_at' || key === 'description') continue;
      if (SCOPE_KEYS.has(key)) continue;
      const value = patch[key];
      if (value !== undefined) (dbPatch as Record<string, unknown>)[key] = value;
    }
    if (patch.description !== undefined) {
      const merged = mergeDescription(existing.description, patch.description);
      if (merged !== undefined) dbPatch.description = merged;
    }
    if (metadata !== undefined) dbPatch.metadata = metadata;
    if (completedAt !== undefined) dbPatch.completed_at = completedAt;
    if (!statusChanged) delete dbPatch.status;

    const task =
      Object.keys(dbPatch).length > 0
        ? await this.store.tasks.update(scope, existing.id, dbPatch, storeOptions)
        : existing;

    if (statusChanged) {
      const updatedMeta = metaOf(task);
      const agentId =
        actor.agentId ??
        updatedMeta.claimed_by ??
        task.assignee ??
        existingMeta.claimed_by ??
        existing.assignee ??
        null;
      await this.store.activity.append(scope, {
        event_type: eventType,
        severity: 'info',
        source: actor.source,
        title: activity.title ?? `Task status changed: ${fromStatus} → ${task.status}`,
        task_id: task.id,
        agent_id: agentId,
        actor_user_id: actor.userId ?? null,
        user_id: actor.ownerUserId ?? null,
        details: { task_id: task.id, previous_status: fromStatus, new_status: task.status },
      });

      if (movingToDone && existingMeta.claimed_by) {
        await this.store.agents.upsertStatus(scope, {
          agentName: existingMeta.claimed_by,
          status: 'online',
          currentTaskId: null,
          userId: actor.ownerUserId ?? null,
        });
        await this.store.agents.appendHeartbeat(scope, {
          agentId: existingMeta.claimed_by,
          eventType: 'task_completed',
          metadata: { task_id: task.id, task_title: existing.title },
        });
      }
    }

    return { task, previous: existing, statusChanged, completed: movingToDone };
  }
}

/**
 * Keeps prior content when a description is replaced, and refuses to clear a
 * description that has content. Returns undefined when nothing should be written.
 */
export function mergeDescription(
  existing: string | null,
  incoming: string | null | undefined,
): string | null | undefined {
  const existingDesc = existing?.trim();
  const newDesc = typeof incoming === 'string' ? incoming.trim() : '';
  if (existingDesc && newDesc && newDesc !== existingDesc && !newDesc.includes(existingDesc)) {
    return `${newDesc}\n\n---\n\n*Previous description:*\n\n${existingDesc}`;
  }
  if (existingDesc && !newDesc) return undefined;
  return incoming;
}
