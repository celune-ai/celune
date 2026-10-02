import type { ActorContext, TaskUpdateResult, WorkspaceScope } from '@celuneai/core';
import type { Task } from '@repo/types';
import type { AuthContext } from './auth/types.ts';

/** Encryption, HMAC, and callbacks stay with the host; the package only routes bytes. */
export interface JobCrypto {
  /** Both arguments are hex, with or without the bytea `\x` marker. */
  decrypt(encryptedHex: string, ivHex: string): string;
  /** Returns bytea-ready hex columns. */
  encrypt(plaintext: string): { result_encrypted: string; result_iv: string };
  verifyHmac(
    fields: { jobId: string; jobType: string; model: string; nonce: string; workspaceId: string },
    hmac: string,
  ): boolean;
}

export interface EmployedAgentSummary {
  agent_id: string;
  display_name: string | null;
  role: string | null;
  agent_type: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string | null;
  slug: string | null;
  is_default?: boolean;
  created_at?: string | null;
  [key: string]: unknown;
}

export type ResolvedWorkspace = { workspaceId: string; orgId: string | null };

export interface ToolCallInfo {
  auth: AuthContext;
  tool: string;
  workspaceId: string;
}

/** A task write the UI made through v1; hosts use it for webhooks, notifications, and metering. */
export type TaskChange =
  | { kind: 'created'; scope: WorkspaceScope; actor: ActorContext; task: Task }
  | ({ kind: 'updated'; scope: WorkspaceScope; actor: ActorContext } & TaskUpdateResult);

/** Agent memory entries a task references through context_keys. */
export interface TaskContextEntry {
  id: string;
  content: string;
  [key: string]: unknown;
}

export interface ServerRunRequest {
  scope: WorkspaceScope;
  task: Task;
  agentId: string;
  userId: string;
}

/** Every hook is optional; without a host the package answers with self-host defaults. */
export interface ApiHost {
  /** Grants an API key principal access to a workspace other than its default. */
  resolveWorkspace?(
    auth: AuthContext,
    workspaceId: string,
  ): Promise<ResolvedWorkspace | { error: string }>;
  jobs?: {
    crypto?: JobCrypto;
    onCompleted?(scope: WorkspaceScope, jobId: string): Promise<void> | void;
  };
  agents?: {
    isEmployed?(workspaceId: string, agentId: string): Promise<boolean>;
    listEmployed?(workspaceId: string): Promise<EmployedAgentSummary[]>;
  };
  describeWorkspace?(auth: AuthContext, workspaceId: string): Promise<WorkspaceSummary | null>;
  tasks?: {
    /** Called after a v1 create, patch, reorder, or initiate succeeds. Errors are logged and ignored. */
    onChange?(change: TaskChange): Promise<void> | void;
    /** Resolves context_keys to agent memory entries. Without it, context is empty. */
    context?(scope: WorkspaceScope, keys: string[]): Promise<TaskContextEntry[]>;
    /** Token and cost totals for a task. Without it, usage answers `{ hasUsage: false }`. */
    usage?(scope: WorkspaceScope, taskId: string): Promise<Record<string, unknown>>;
  };
  executions?: {
    /** Queues a server run for an initiated task; resolves the job id, or null when skipped. */
    enqueue?(request: ServerRunRequest): Promise<{ id: string } | null>;
  };
  onToolCall?(info: ToolCallInfo): void;
}

export async function resolveWorkspaceFor(
  host: ApiHost,
  auth: AuthContext,
  requested: string | undefined,
): Promise<ResolvedWorkspace | { error: string; status: 403 | 404 }> {
  if (!requested || requested === auth.workspaceId) {
    return { workspaceId: auth.workspaceId, orgId: auth.orgId };
  }
  if (auth.principal === 'jwt') {
    return { error: 'Token is scoped to another workspace', status: 403 };
  }
  if (!host.resolveWorkspace) {
    return { error: 'You do not have access to this workspace', status: 403 };
  }
  const resolved = await host.resolveWorkspace(auth, requested);
  if ('error' in resolved) return { error: resolved.error, status: 403 };
  return resolved;
}
