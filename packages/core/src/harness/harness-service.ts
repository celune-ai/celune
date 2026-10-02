import type { Task, TaskMetadata } from '@repo/types';
import type { ActorContext } from '../actor.ts';
import { Conflict, GateDenied, Unavailable, ValidationError } from '../errors.ts';
import { NoopGate, type Gate } from '../gate.ts';
import type { WorkspaceScope } from '../scope.ts';
import type {
  HarnessConnection,
  HarnessConnectionStore,
  HarnessRunMarker,
  Store,
  TaskPatch,
} from '../store.ts';
import type { TaskService } from '../tasks/task-service.ts';
import { defaultRunEventMapping } from './mapping.ts';
import { HarnessRegistry, type HarnessBinding } from './registry.ts';
import {
  isHarnessRunStatus,
  isTerminalRunStatus,
  type HarnessAdapter,
  type HarnessEffect,
  type HarnessRunEvent,
  type HarnessRunRecord,
  type HarnessRunRef,
  type HarnessRunStatus,
  type HarnessTaskInput,
} from './types.ts';

type Meta = TaskMetadata & Record<string, unknown>;

/** Applied event ids kept on the task; enough to cover any realistic retry window. */
const EVENT_ID_HISTORY = 50;

/** blocked_by prefix for blocks the harness set, so a later run may lift them. */
export const HARNESS_BLOCKER_PREFIX = 'harness:';

/**
 * Atomic dedupe on event id. Hosts with several API replicas back this with a
 * unique index; the in-memory ledger covers one process.
 */
export interface HarnessEventLedger {
  /** Resolves false when the id was already taken. */
  take(scope: WorkspaceScope, eventId: string): Promise<boolean>;
  /** Frees an id after a failed apply so the sender can retry. */
  release(scope: WorkspaceScope, eventId: string): Promise<void>;
}

export class InMemoryHarnessLedger implements HarnessEventLedger {
  private readonly taken = new Map<string, true>();
  private readonly max: number;

  constructor(max = 10_000) {
    this.max = max;
  }

  async take(scope: WorkspaceScope, eventId: string): Promise<boolean> {
    const key = `${scope.workspaceId}:${eventId}`;
    if (this.taken.has(key)) return false;
    this.taken.set(key, true);
    if (this.taken.size > this.max) {
      const oldest = this.taken.keys().next().value;
      if (oldest !== undefined) this.taken.delete(oldest);
    }
    return true;
  }

  async release(scope: WorkspaceScope, eventId: string): Promise<void> {
    this.taken.delete(`${scope.workspaceId}:${eventId}`);
  }
}

export interface HarnessServiceOptions {
  registry?: HarnessRegistry;
  ledger?: HarnessEventLedger;
  /** Checked for `agent.run` before a claim starts a run. */
  gate?: Gate;
  clock?: () => Date;
}

export interface HarnessClaimOptions {
  /** False for callers that must not start runs, such as browser embed tokens. */
  allowRunStart?: boolean;
}

/** Attempts per event when a concurrent write changes the run first. */
const APPLY_ATTEMPTS = 3;

export interface HarnessClaimResult {
  task: Task;
  run: HarnessRunRef | null;
  /** Set when the harness refused to start; the task is then blocked. */
  error?: string;
}

export interface HarnessEventResult {
  task: Task;
  /** The task before this event. Equal to task when nothing was applied. */
  previous: Task;
  applied: boolean;
  duplicate: boolean;
  stale: boolean;
  effect: HarnessEffect | null;
}

/** A task whose harness run has not ended, as a watcher needs it to resume polling. */
export interface ActiveHarnessRun {
  task_id: string;
  harness: string;
  run_id: string;
  harness_agent: string | null;
  status: HarnessRunStatus;
  last_event_at: string | null;
  /** Recent applied event ids on the task, so a watcher can continue repeat counters. */
  event_ids: string[];
  /** Host principal the run was started as, so a watcher reads it with the same credentials. */
  run_as: string | null;
}

export interface HarnessConnectInput {
  harness: string;
  /** Celune agent id to harness agent id. */
  agents: Record<string, string>;
  /** Adapter settings without credentials, passed to the harness factory. */
  config?: Record<string, unknown>;
  /** Replace the workspace's existing connection instead of refusing. */
  replace?: boolean;
}

/** Config keys that name a credential. Stored connections must not hold one. */
const CREDENTIAL_KEY =
  /(secret|token|password|passwd|api[_-]?key|credential|private[_-]?key|authorization|cookie)/i;

function credentialPath(value: unknown, path: string[] = []): string | null {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const found = credentialPath(item, [...path, String(i)]);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (CREDENTIAL_KEY.test(key)) return [...path, key].join('.');
      const found = credentialPath(item, [...path, key]);
      if (found) return found;
    }
  }
  return null;
}

function validAgentMap(agents: unknown): Record<string, string> {
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
    throw new ValidationError('agents must map Celune agent ids to harness agent ids');
  }
  const out: Record<string, string> = {};
  for (const [agentId, harnessAgentId] of Object.entries(agents)) {
    if (!agentId || typeof harnessAgentId !== 'string' || !harnessAgentId) {
      throw new ValidationError('agents must map Celune agent ids to harness agent ids', {
        agentId,
      });
    }
    out[agentId] = harnessAgentId;
  }
  return out;
}

/** Upper bound on runs one resync returns. */
const ACTIVE_RUNS_LIMIT = 500;

function metaOf(task: Task): Meta {
  return { ...((task.metadata ?? {}) as Meta) };
}

function runOf(task: Task): HarnessRunRecord | null {
  const run = metaOf(task).harness_run as HarnessRunRecord | undefined;
  return run && typeof run.run_id === 'string' ? run : null;
}

function markerOf(run: HarnessRunRecord | null): HarnessRunMarker {
  return { runId: run?.run_id ?? null, lastEventId: run?.last_event_id ?? null };
}

function sameMarker(a: HarnessRunMarker, b: HarnessRunMarker): boolean {
  return a.runId === b.runId && a.lastEventId === b.lastEventId;
}

function toTaskInput(task: Task, scope: WorkspaceScope): HarnessTaskInput {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    priority: String(task.priority),
    projectId: task.project_id,
    workspaceId: scope.workspaceId,
    orgId: task.org_id ?? scope.orgId,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'unknown error';
}

/**
 * Connects TaskService to a host agent runtime. Outbound, a claim by a mapped
 * agent starts a run. Inbound, run events move the task through TaskService,
 * so the transition validator decides every status change.
 */
export class HarnessService {
  readonly registry: HarnessRegistry;
  private readonly store: Store;
  private readonly tasks: TaskService;
  private readonly ledger: HarnessEventLedger;
  private readonly gate: Gate;
  private readonly clock: () => Date;
  /** Adapters built from stored connections, by workspace, until the row changes. */
  private readonly stored = new Map<string, { updatedAt: string; binding: HarnessBinding }>();

  constructor(store: Store, tasks: TaskService, options: HarnessServiceOptions = {}) {
    this.store = store;
    this.tasks = tasks;
    this.registry = options.registry ?? new HarnessRegistry();
    this.ledger = options.ledger ?? new InMemoryHarnessLedger();
    this.gate = options.gate ?? new NoopGate();
    this.clock = options.clock ?? (() => new Date());
  }

  /** The workspace's stored harness connection, or null. */
  async connection(scope: WorkspaceScope): Promise<HarnessConnection | null> {
    return this.connections().get(scope);
  }

  /**
   * Stores the workspace's harness registration so it survives a restart. The
   * harness must have a factory in the registry; config must hold no credentials.
   */
  async connect(
    scope: WorkspaceScope,
    input: HarnessConnectInput,
    actor: ActorContext,
  ): Promise<HarnessConnection> {
    const connections = this.connections();
    const harness = typeof input.harness === 'string' ? input.harness.trim() : '';
    if (!harness) throw new ValidationError('harness is required');
    if (this.registry.get(scope.workspaceId)) {
      throw new Conflict('This workspace has a harness adapter registered by the host', {
        harness: this.registry.get(scope.workspaceId)?.adapter.capabilities().name,
      });
    }
    const factory = this.registry.factory(harness);
    if (!factory) throw new ValidationError(`No adapter for harness ${harness}`, { harness });
    const agents = validAgentMap(input.agents);
    const config = input.config ?? {};
    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new ValidationError('config must be an object');
    }
    const secret = credentialPath(config);
    if (secret) {
      throw new ValidationError(
        'Harness config must not hold credentials. Keep them in the host environment or provider key storage.',
        { field: secret },
      );
    }
    const existing = await connections.get(scope);
    if (existing && !input.replace) {
      throw new Conflict('Workspace already has a harness connection', {
        harness: existing.harness,
      });
    }
    // Build the adapter first so a config the factory refuses is never stored.
    const adapter = factory(config, { workspaceId: scope.workspaceId });
    if (adapter.capabilities().name !== harness) {
      throw new ValidationError('Harness factory returned an adapter for another harness', {
        harness,
        adapter: adapter.capabilities().name,
      });
    }
    const saved = await connections.upsert(scope, {
      harness,
      agents,
      config,
      createdBy: actor.userId ?? null,
    });
    this.stored.set(scope.workspaceId, {
      updatedAt: saved.updatedAt,
      binding: { adapter, agents: Object.freeze({ ...saved.agents }) },
    });
    return saved;
  }

  /** Removes the stored connection; resolves false when there was none. */
  async disconnect(scope: WorkspaceScope): Promise<boolean> {
    this.stored.delete(scope.workspaceId);
    return this.connections().remove(scope);
  }

  private connections(): HarnessConnectionStore {
    const connections = this.store.harnessConnections;
    if (!connections) throw new Unavailable('This host does not store harness connections');
    return connections;
  }

  /** The host's adapter for the workspace, else one built from its stored connection. */
  private async binding(scope: WorkspaceScope): Promise<HarnessBinding | null> {
    const registered = this.registry.get(scope.workspaceId);
    if (registered) return registered;
    const connections = this.store.harnessConnections;
    if (!connections) return null;
    const row = await connections.get(scope);
    if (!row) {
      this.stored.delete(scope.workspaceId);
      return null;
    }
    const cached = this.stored.get(scope.workspaceId);
    if (cached && cached.updatedAt === row.updatedAt) return cached.binding;
    const factory = this.registry.factory(row.harness);
    if (!factory) return null;
    const binding: HarnessBinding = {
      adapter: factory(row.config, { workspaceId: scope.workspaceId }),
      agents: Object.freeze({ ...row.agents }),
    };
    this.stored.set(scope.workspaceId, { updatedAt: row.updatedAt, binding });
    return binding;
  }

  /** Claims the task, then starts a run when the agent maps to a harness agent. */
  async claim(
    scope: WorkspaceScope,
    taskId: string,
    agentId: string,
    actor: ActorContext,
    options: HarnessClaimOptions = {},
  ): Promise<HarnessClaimResult> {
    const binding = await this.binding(scope);
    const harnessAgentId =
      binding && Object.hasOwn(binding.agents, agentId) ? binding.agents[agentId] : undefined;
    const resolved =
      binding && harnessAgentId ? { adapter: binding.adapter, harnessAgentId } : null;
    if (resolved) {
      if (options.allowRunStart === false) {
        throw new GateDenied(
          'agent.run',
          'This token cannot start agent runs. Assign the task and let the agent claim it.',
        );
      }
      const verdict = await this.gate.check('agent.run', { scope, userId: actor.userId });
      if (!verdict.allowed) {
        throw new GateDenied('agent.run', verdict.reason, {
          status: verdict.status,
          upgradeUrl: verdict.upgradeUrl,
          details: verdict.details,
        });
      }
    }

    const task = await this.tasks.claim(scope, taskId, agentId, actor);
    if (!resolved) return { task, run: null };

    // The harness agent often claims through MCP from inside its own run; do not start a second one.
    const current = runOf(task);
    if (current && !isTerminalRunStatus(current.status)) {
      return { task, run: { harness: current.harness, runId: current.run_id } };
    }

    // Reserve the run slot first so a concurrent claim sees an active run and starts nothing.
    const caps = resolved.adapter.capabilities();
    const pending: HarnessRunRecord = {
      harness: caps.name,
      run_id: `pending:${globalThis.crypto.randomUUID()}`,
      harness_agent: resolved.harnessAgentId,
      status: 'queued',
      started_at: this.clock().toISOString(),
      event_ids: [],
    };
    const reserved = await this.writeRun(scope, taskId, markerOf(current), pending);
    if (!reserved) {
      const latest = await this.tasks.get(scope, taskId);
      const run = runOf(latest);
      return {
        task: latest,
        run:
          run && !isTerminalRunStatus(run.status)
            ? { harness: run.harness, runId: run.run_id }
            : null,
      };
    }

    let started;
    try {
      started = await resolved.adapter.startRun(toTaskInput(task, scope), {
        scope,
        agentId,
        harnessAgentId: resolved.harnessAgentId,
        actor,
      });
    } catch (error) {
      const message = messageOf(error);
      await this.writeRun(scope, taskId, markerOf(pending), current);
      const blocked = await this.tasks.block(
        scope,
        taskId,
        { reason: `Harness start failed: ${message}`, agentId: HARNESS_BLOCKER_PREFIX + caps.name },
        actor,
      );
      return { task: blocked, run: null, error: message };
    }

    const record: HarnessRunRecord = {
      ...pending,
      run_id: started.runId,
      status: started.status ?? 'queued',
      url: started.url ?? null,
      ...(started.runAs ? { run_as: started.runAs } : {}),
    };
    const updated = await this.writeRun(scope, taskId, markerOf(pending), record);
    if (!updated) {
      throw new Conflict('Task run changed while the harness run was starting', {
        taskId,
        runId: started.runId,
      });
    }
    await this.store.activity.append(scope, {
      event_type: 'harness.run.started',
      severity: 'info',
      source: actor.source,
      title: `${caps.name} run started: ${task.title}`,
      task_id: taskId,
      agent_id: agentId,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
      details: { task_id: taskId, harness: caps.name, run_id: started.runId },
    });
    return { task: updated, run: { harness: caps.name, runId: started.runId } };
  }

  /**
   * Runs of one harness that Celune still records as active in this workspace.
   * A watcher calls this after a restart to pick polling back up.
   */
  async activeRuns(scope: WorkspaceScope, harness: string): Promise<ActiveHarnessRun[]> {
    if (!harness.trim()) throw new ValidationError('harness is required');
    const tasks = await this.store.tasks.list(scope, {
      activeHarnessRun: harness,
      limit: ACTIVE_RUNS_LIMIT,
    });
    const runs: ActiveHarnessRun[] = [];
    for (const task of tasks) {
      const run = runOf(task);
      if (!run || run.harness !== harness || isTerminalRunStatus(run.status)) continue;
      runs.push({
        task_id: task.id,
        harness: run.harness,
        run_id: run.run_id,
        harness_agent: run.harness_agent ?? null,
        status: run.status,
        last_event_at: run.last_event_at ?? null,
        event_ids: run.event_ids ?? [],
        run_as: run.run_as ?? null,
      });
    }
    return runs;
  }

  /** Applies one inbound run event. Safe to call again with the same event id. */
  async applyEvent(
    scope: WorkspaceScope,
    event: HarnessRunEvent,
    actor: ActorContext,
  ): Promise<HarnessEventResult> {
    validateEvent(event);
    if (!(await this.ledger.take(scope, event.id))) {
      const task = await this.tasks.get(scope, event.taskId);
      return { task, previous: task, applied: false, duplicate: true, stale: false, effect: null };
    }
    try {
      return await this.apply(scope, event, actor);
    } catch (error) {
      await this.ledger.release(scope, event.id);
      throw error;
    }
  }

  /** Pulls the run state from the harness and applies it as an event. */
  async heartbeat(
    scope: WorkspaceScope,
    taskId: string,
    actor: ActorContext,
  ): Promise<HarnessEventResult> {
    const { adapter, ref } = await this.adapterForRun(scope, taskId);
    if (!adapter.capabilities().heartbeat) {
      throw new Unavailable(`Harness ${ref.harness} does not support heartbeat`);
    }
    const beat = await adapter.heartbeat(ref);
    return this.applyEvent(
      scope,
      {
        id: `heartbeat:${ref.runId}:${beat.at}`,
        taskId,
        runRef: ref,
        status: beat.status,
        occurredAt: beat.at,
        progress: beat.progress,
      },
      actor,
    );
  }

  /** Stops the run in the harness, then returns the task to planning. */
  async cancel(
    scope: WorkspaceScope,
    taskId: string,
    actor: ActorContext,
  ): Promise<HarnessEventResult> {
    const { adapter, ref, run } = await this.adapterForRun(scope, taskId);
    if (isTerminalRunStatus(run.status)) {
      throw new ValidationError('Run already ended', { runId: ref.runId, status: run.status });
    }
    if (!adapter.capabilities().cancel) {
      throw new Unavailable(`Harness ${ref.harness} does not support cancel`);
    }
    await adapter.cancelRun(ref);
    return this.applyEvent(
      scope,
      {
        id: `cancel:${ref.runId}`,
        taskId,
        runRef: ref,
        status: 'cancelled',
        occurredAt: this.clock().toISOString(),
      },
      actor,
    );
  }

  private async adapterForRun(scope: WorkspaceScope, taskId: string) {
    const task = await this.tasks.get(scope, taskId);
    const run = runOf(task);
    if (!run) throw new ValidationError('Task has no harness run', { taskId });
    const binding = await this.binding(scope);
    if (!binding || binding.adapter.capabilities().name !== run.harness) {
      throw new Unavailable(`No adapter registered for harness ${run.harness}`);
    }
    const ref: HarnessRunRef = { harness: run.harness, runId: run.run_id };
    return { adapter: binding.adapter as HarnessAdapter, ref, run };
  }

  private async apply(
    scope: WorkspaceScope,
    event: HarnessRunEvent,
    actor: ActorContext,
  ): Promise<HarnessEventResult> {
    for (let attempt = 1; ; attempt++) {
      const result = await this.applyOnce(scope, event, actor);
      if (result) return result;
      if (attempt >= APPLY_ATTEMPTS) {
        throw new Conflict('Task run changed during the event; retry it', {
          taskId: event.taskId,
          eventId: event.id,
        });
      }
    }
  }

  /** Resolves null when another write changed the run between the read and the write. */
  private async applyOnce(
    scope: WorkspaceScope,
    event: HarnessRunEvent,
    actor: ActorContext,
  ): Promise<HarnessEventResult | null> {
    const original = await this.tasks.get(scope, event.taskId);
    let task = original;
    const previous = runOf(task);

    if (previous?.event_ids.includes(event.id)) {
      return {
        task,
        previous: original,
        applied: false,
        duplicate: true,
        stale: false,
        effect: null,
      };
    }

    const sameRun = previous?.run_id === event.runRef.runId;
    if (previous && previous.harness !== event.runRef.harness) {
      throw new ValidationError('Event harness does not match the run on this task', {
        expected: previous.harness,
        received: event.runRef.harness,
      });
    }
    if (previous && !sameRun && !isTerminalRunStatus(previous.status)) {
      throw new ValidationError('Event run does not match the active run on this task', {
        activeRunId: previous.run_id,
        receivedRunId: event.runRef.runId,
      });
    }

    const base: HarnessRunRecord =
      previous && sameRun
        ? previous
        : {
            harness: event.runRef.harness,
            run_id: event.runRef.runId,
            harness_agent: null,
            status: event.status,
            started_at: event.occurredAt,
            event_ids: previous?.event_ids ?? [],
          };

    const eventIds = [...base.event_ids, event.id].slice(-EVENT_ID_HISTORY);
    const occurred = Date.parse(event.occurredAt);
    // A different run may start only after the current one ended; earlier events are from an older run.
    const olderRun =
      Boolean(previous) &&
      !sameRun &&
      occurred <= Date.parse(previous!.ended_at ?? previous!.last_event_at ?? previous!.started_at);
    // A run ends once: after a terminal status every later event for it is stale,
    // so a watcher and a cancel racing each other cannot both apply an ending.
    const stale =
      olderRun ||
      (sameRun &&
        Boolean(previous) &&
        ((previous!.last_event_at !== undefined &&
          occurred < Date.parse(previous!.last_event_at)) ||
          isTerminalRunStatus(previous!.status)));

    if (stale) {
      // Best effort: remembering the id only saves a later duplicate check.
      const kept = sameRun
        ? await this.writeRun(scope, task.id, markerOf(previous), {
            ...previous!,
            event_ids: eventIds,
          })
        : null;
      return {
        task: kept ?? task,
        previous: original,
        applied: false,
        duplicate: false,
        stale: true,
        effect: null,
      };
    }

    const adapter = (await this.binding(scope))?.adapter;
    const effect =
      adapter && adapter.capabilities().name === event.runRef.harness
        ? adapter.onRunEvent(event)
        : defaultRunEventMapping(event);

    // Record the event first, conditional on the run this read saw, so concurrent events apply one at a time.
    const record: HarnessRunRecord = {
      ...base,
      status: event.status,
      last_event_id: event.id,
      last_event_at: event.occurredAt,
      event_ids: eventIds,
      ...(isTerminalRunStatus(event.status) ? { ended_at: event.occurredAt } : {}),
    };
    const extra = {} as Meta;
    if (effect.release) extra.active_session = false;
    if (effect.actionState !== undefined) extra.action_state = effect.actionState;
    const reserved = await this.writeRun(scope, task.id, markerOf(previous), record, extra);
    if (!reserved) return null;
    task = reserved;

    const workerId = (metaOf(task).claimed_by as string | undefined) ?? actor.agentId ?? null;
    try {
      task = await this.applyEffect(scope, task, event, effect, base, workerId, actor);
    } catch (error) {
      // Put the previous run back so the sender's retry is not taken for a duplicate.
      await this.writeRun(scope, task.id, markerOf(record), previous);
      throw error;
    }

    await this.store.activity.append(scope, {
      event_type: `harness.run.${event.status}`,
      severity: effect.block ? 'warning' : 'info',
      source: actor.source,
      title: `${event.runRef.harness} run ${event.status}: ${task.title}`,
      task_id: task.id,
      agent_id: workerId,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
      details: {
        task_id: task.id,
        harness: event.runRef.harness,
        run_id: event.runRef.runId,
        event_id: event.id,
        task_status: task.status,
      },
    });

    return { task, previous: original, applied: true, duplicate: false, stale: false, effect };
  }

  private async applyEffect(
    scope: WorkspaceScope,
    start: Task,
    event: HarnessRunEvent,
    effect: HarnessEffect,
    base: HarnessRunRecord,
    workerId: string | null,
    actor: ActorContext,
  ): Promise<Task> {
    let task = start;
    const meta = metaOf(task);
    const workerActor: ActorContext = { ...actor, agentId: workerId };
    const harnessBlocker = HARNESS_BLOCKER_PREFIX + event.runRef.harness;

    if (
      effect.unblock &&
      meta.blocked &&
      String(meta.blocked_by ?? '').startsWith(HARNESS_BLOCKER_PREFIX)
    ) {
      task = await this.tasks.unblock(scope, task.id, workerActor);
    }

    const current = task.status as string;
    if (effect.status && effect.status !== current) {
      const outcome = effect.outcome?.trim() || null;
      if (effect.status === 'done') {
        task = await this.tasks.complete(
          scope,
          task.id,
          { outcome, agentId: workerId },
          workerActor,
        );
      } else {
        const result = await this.tasks.updateStatus(
          scope,
          task.id,
          effect.status,
          workerActor,
          outcome ? { outcome } : {},
        );
        task = result.task;
      }
    }

    if (effect.block) {
      task = await this.tasks.block(
        scope,
        task.id,
        { reason: effect.block, agentId: harnessBlocker },
        workerActor,
      );
    }

    const agentName = base.harness_agent ?? workerId;
    if (effect.heartbeat && agentName) {
      await this.store.agents.appendHeartbeat(scope, {
        agentId: agentName,
        // heartbeat_events.event_type is a closed set in the database; the run status rides in metadata.
        eventType: 'working',
        metadata: {
          harness_status: event.status,
          task_id: task.id,
          harness: event.runRef.harness,
          run_id: event.runRef.runId,
          ...(event.progress ? { progress: event.progress } : {}),
        },
      });
    }
    if (workerId) {
      const terminal = isTerminalRunStatus(event.status);
      if (!terminal || effect.release) {
        await this.store.agents.upsertStatus(scope, {
          agentName: workerId,
          status: terminal ? 'online' : 'working',
          currentTaskId: terminal ? null : task.id,
          userId: actor.ownerUserId ?? null,
        });
      }
    }
    return task;
  }

  /**
   * Sets metadata.harness_run (null removes it) plus `extra`, only while the run
   * still matches `expected`. Resolves null when it no longer does.
   */
  private async writeRun(
    scope: WorkspaceScope,
    taskId: string,
    expected: HarnessRunMarker,
    record: HarnessRunRecord | null,
    extra: Meta = {} as Meta,
  ): Promise<Task | null> {
    const fresh = await this.tasks.get(scope, taskId);
    if (!sameMarker(markerOf(runOf(fresh)), expected)) return null;
    const metadata = { ...metaOf(fresh), ...extra, harness_run: record } as Record<string, unknown>;
    const conditional = this.store.tasks.replaceMetadataIfRun;
    if (conditional) {
      return conditional.call(this.store.tasks, scope, taskId, expected, metadata);
    }
    return this.store.tasks.update(scope, taskId, { metadata } as unknown as TaskPatch);
  }
}

function validateEvent(event: HarnessRunEvent): void {
  const problems: string[] = [];
  if (!event.id?.trim()) problems.push('id');
  if (!event.taskId?.trim()) problems.push('taskId');
  if (!event.runRef?.harness?.trim()) problems.push('runRef.harness');
  if (!event.runRef?.runId?.trim()) problems.push('runRef.runId');
  if (!isHarnessRunStatus(event.status)) problems.push('status');
  if (!event.occurredAt || Number.isNaN(Date.parse(event.occurredAt))) problems.push('occurredAt');
  if (problems.length > 0) {
    throw new ValidationError('Invalid harness event', { fields: problems });
  }
}
