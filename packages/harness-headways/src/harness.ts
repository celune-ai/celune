import {
  defaultRunEventMapping,
  type HarnessAdapter,
  type HarnessCapabilities,
  type HarnessEffect,
  type HarnessHeartbeat,
  type HarnessRunContext,
  type HarnessRunEvent,
  type HarnessRunRef,
  type HarnessTaskInput,
  type RunEventMappingOptions,
  type StartRunResult,
} from '@celuneai/core';
import { HeadwaysClient, type FetchLike } from './headways-client.ts';
import { toHarnessRunStatus } from './status.ts';
import type { HeadwaysRunWatcher } from './watcher.ts';

export const HEADWAYS_HARNESS_NAME = 'headways';

/** What one harness agent id runs as in Headways. */
export interface HeadwaysRunProfile {
  model: string;
  /** Lowers the org ceiling for this agent; Headways never lets it exceed the org cap. */
  budgetUsdMax?: number;
  skills?: Array<{ slug: string; version: string }>;
  connectors?: Array<{ key: string; name?: string }>;
}

export interface HeadwaysHarnessOptions {
  apiUrl: string;
  /** Web origin, for the run link written to the task. */
  webUrl?: string;
  orgSlug: string;
  /** API key of the org owner. Workstreams fall back to this owner. */
  apiKey: string;
  /**
   * API keys of Headways users by email. When the person who assigned the task
   * has one, the Workstream is created as that user, so they own it.
   */
  userKeys?: Record<string, string>;
  /** Resolves the assigner's email for a claim; null uses the org owner. */
  resolveOwnerEmail?: (
    task: HarnessTaskInput,
    context: HarnessRunContext,
  ) => Promise<string | null>;
  /** Harness agent id (from the registry agent map) to run profile. */
  profiles: Record<string, HeadwaysRunProfile>;
  /** Name of the Celune MCP connector the brief tells the agent to use. */
  mcpConnectorKey?: string;
  watcher?: HeadwaysRunWatcher;
  mapping?: RunEventMappingOptions;
  fetch?: FetchLike;
  /** Per-request timeout for Headways calls. Default 15 s. */
  requestTimeoutMs?: number;
  clock?: () => Date;
}

/**
 * Runs Celune tasks as Headways AgentRuns. A claim by a mapped agent creates a
 * Workstream with the task as its goal, a group thread holding the task brief,
 * and an AgentRun triggered by that brief. Status comes back through the watcher.
 */
export class HeadwaysHarness implements HarnessAdapter {
  private readonly options: HeadwaysHarnessOptions;
  private readonly owner: HeadwaysClient;
  private readonly clients = new Map<string, HeadwaysClient>();
  /** Run id to the client that created it, so heartbeat and cancel act as the owner. */
  private readonly runClients = new Map<string, HeadwaysClient>();
  /** Task id to Workstream id, so a second run for a task reuses its Workstream. */
  private readonly workstreams = new Map<string, { workstreamId: string; threadId: string }>();
  private readonly clock: () => Date;

  constructor(options: HeadwaysHarnessOptions) {
    this.options = options;
    this.clock = options.clock ?? (() => new Date());
    this.owner = this.client(options.apiKey);
    // A run resumed after a restart is read with the key of the user it was started as.
    options.watcher?.useClients((run) => this.clientForResumed(run.run_id, run.run_as ?? null));
  }

  capabilities(): HarnessCapabilities {
    return {
      name: HEADWAYS_HARNESS_NAME,
      version: '0.1.0',
      cancel: true,
      heartbeat: true,
      budgets: true,
    };
  }

  async startRun(task: HarnessTaskInput, context: HarnessRunContext): Promise<StartRunResult> {
    const profile = this.options.profiles[context.harnessAgentId];
    if (!profile) {
      throw new Error(`No Headways run profile for harness agent ${context.harnessAgentId}`);
    }
    const { client, runAs } = await this.clientFor(task, context);
    const attempt = this.clock().getTime().toString(36);

    let place = this.workstreams.get(task.id);
    if (!place) {
      const workstream = await client.createWorkstream({
        goal: goalOf(task),
        clientRequestId: `celune:${task.id}:workstream`,
      });
      const thread = await client.createGroupThread(workstream.id, {
        title: `Celune task: ${task.title}`.slice(0, 200),
        clientRequestId: `celune:${task.id}:thread`,
      });
      place = { workstreamId: workstream.id, threadId: thread.id };
      this.workstreams.set(task.id, place);
    }

    const message = await client.postMessage(place.threadId, {
      content: this.brief(task, context),
      clientRequestId: `celune:${task.id}:brief:${attempt}`,
    });
    const run = await client.createRun(place.workstreamId, {
      threadId: place.threadId,
      model: profile.model,
      budgetUsdMax: profile.budgetUsdMax,
      skills: profile.skills,
      connectors: profile.connectors,
      triggeringMessageId: message.id,
      clientRequestId: `celune:${task.id}:run:${attempt}`,
    });

    this.runClients.set(run.id, client);
    this.options.watcher?.track(run.id, task.id, client);
    const web = this.options.webUrl?.replace(/\/$/, '');
    return {
      runId: run.id,
      status: toHarnessRunStatus(run.status),
      url: web ? `${web}/workstreams/${place.workstreamId}` : null,
      runAs,
    };
  }

  onRunEvent(event: HarnessRunEvent): HarnessEffect {
    return defaultRunEventMapping(event, this.options.mapping);
  }

  async heartbeat(runRef: HarnessRunRef): Promise<HarnessHeartbeat> {
    const run = await this.clientForRun(runRef.runId).getRun(runRef.runId);
    const at = this.clock().toISOString();
    if (!run) return { status: 'queued', at };
    return {
      status: toHarnessRunStatus(run.status),
      at,
      progress: {
        tokens_input: run.tokensInput,
        tokens_output: run.tokensOutput,
        cost_usd: run.costUsd,
      },
    };
  }

  async cancelRun(runRef: HarnessRunRef): Promise<void> {
    // HarnessService applies the cancelled event itself, so the watcher lets go of
    // the run before the cancel starts and a resync cannot pick it up meanwhile.
    const settle = this.options.watcher?.beginCancel(runRef.runId);
    try {
      await this.clientForRun(runRef.runId).cancelRun(runRef.runId, `cancel:${runRef.runId}`);
    } finally {
      settle?.();
    }
  }

  private brief(task: HarnessTaskInput, context: HarnessRunContext): string {
    const mcp = `mcp__${this.options.mcpConnectorKey ?? 'celune'}`;
    return [
      `Celune task ${task.id} (priority ${task.priority}): ${task.title}`,
      '',
      task.description?.trim() || 'No description.',
      '',
      `You are the Celune agent "${context.agentId}". Read the task with ${mcp} get_task and post progress with add_comment.`,
      'Create follow-up work with create_task. Do not call complete_task or block_task on this task:',
      'the run result reports its status to Celune. End with a short summary of what you did; it becomes the task outcome.',
    ].join('\n');
  }

  private async clientFor(
    task: HarnessTaskInput,
    context: HarnessRunContext,
  ): Promise<{ client: HeadwaysClient; runAs: string | null }> {
    const email = (await this.options.resolveOwnerEmail?.(task, context))?.toLowerCase();
    const key = email ? this.options.userKeys?.[email] : undefined;
    return key ? { client: this.client(key), runAs: email! } : { client: this.owner, runAs: null };
  }

  private clientForRun(runId: string): HeadwaysClient {
    return this.runClients.get(runId) ?? this.owner;
  }

  /** Headways only lets the Workstream owner read or cancel its runs, so a resumed run keeps its user's key. */
  private clientForResumed(runId: string, runAs: string | null): HeadwaysClient {
    const known = this.runClients.get(runId);
    if (known) return known;
    const key = runAs ? this.options.userKeys?.[runAs.toLowerCase()] : undefined;
    const client = key ? this.client(key) : this.owner;
    this.runClients.set(runId, client);
    return client;
  }

  private client(apiKey: string): HeadwaysClient {
    let client = this.clients.get(apiKey);
    if (!client) {
      client = new HeadwaysClient({
        apiUrl: this.options.apiUrl,
        apiKey,
        orgSlug: this.options.orgSlug,
        fetch: this.options.fetch,
        timeoutMs: this.options.requestTimeoutMs,
      });
      this.clients.set(apiKey, client);
    }
    return client;
  }
}

function goalOf(task: HarnessTaskInput): string {
  const description = task.description?.trim();
  const goal = description ? `${task.title}\n\n${description}` : task.title;
  return goal.slice(0, 4_000);
}
