import type { ActivityEntry, Project, Task, TaskAttachment, TaskComment } from '@repo/types';

export interface TaskListParams {
  projectId?: string;
  status?: string;
  pageSize?: number;
  offset?: number;
}

/** Task fields to create. Backends ignore fields they do not know. */
export type TaskInput = { title: string } & Record<string, unknown>;

/** Partial task fields to update. */
export type TaskPatch = Record<string, unknown>;

export interface ReorderItem {
  id: string;
  sort_order: number;
  status?: string;
}

export interface TaskChildren {
  children: Task[];
  allComplete: boolean;
}

export interface ContextEntry {
  id: string;
  content: string;
  category?: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface AttachmentUploadResult {
  attachments: TaskAttachment[];
  errors: { file: string; error: string }[];
}

export interface ExecutionRecord {
  id: string;
  status: string;
  [key: string]: unknown;
}

export interface ProgressLogEntry {
  id: string;
  [key: string]: unknown;
}

export interface CommentInput {
  content: string;
  author?: string;
  /** Workspace that owns the task, when it differs from the provider workspace. */
  workspaceId?: string;
}

/**
 * Every data operation the UI performs. Optional members are features a
 * backend may not offer; the UI hides the matching controls when absent.
 */
export interface CeluneTransport {
  tasks: {
    list(params?: TaskListParams): Promise<Task[]>;
    count(params?: Pick<TaskListParams, 'projectId'>): Promise<number>;
    get(id: string): Promise<Task>;
    create(input: TaskInput): Promise<Task>;
    update(id: string, patch: TaskPatch): Promise<Task>;
    remove(id: string): Promise<void>;
    reorder?(items: ReorderItem[]): Promise<void>;
    dependencies?(id: string): Promise<Task[]>;
    children?(id: string): Promise<TaskChildren>;
    spawned?(id: string): Promise<Task[]>;
    context?(id: string): Promise<ContextEntry[]>;
    usage?(id: string): Promise<unknown>;
    initiate?(id: string): Promise<Task>;
  };
  comments: {
    list(taskId: string): Promise<TaskComment[]>;
    create(taskId: string, input: CommentInput): Promise<TaskComment>;
  };
  activity: {
    list(params: { taskId: string; limit?: number }): Promise<ActivityEntry[]>;
  };
  projects: {
    list(): Promise<Project[]>;
    reorder?(items: ReorderItem[]): Promise<void>;
    progressLog?(projectId: string): Promise<ProgressLogEntry[]>;
  };
  attachments?: {
    list(taskId: string): Promise<TaskAttachment[]>;
    upload(
      taskId: string,
      files: File[],
      options?: { uploadedBy?: string; onProgress?: (fraction: number) => void },
    ): Promise<AttachmentUploadResult>;
    remove(taskId: string, attachmentId: string): Promise<void>;
  };
  executions?: {
    list(params: {
      taskId: string;
      workspaceId?: string;
      limit?: number;
    }): Promise<ExecutionRecord[]>;
    cancel(params: { taskId: string; workspaceId?: string }): Promise<void>;
  };
}

export class CeluneTransportError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'CeluneTransportError';
    this.status = status;
    this.body = body;
  }
}

export function isAuthError(err: unknown): boolean {
  return err instanceof CeluneTransportError && err.status === 401;
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof CeluneTransportError && err.body && typeof err.body === 'object') {
    const msg = (err.body as { error?: unknown }).error;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}

export interface RealtimeChange<T = Record<string, unknown>> {
  type: 'INSERT' | 'UPDATE' | 'DELETE' | 'BROADCAST';
  new: T | null;
  old: Partial<T> | null;
}

export interface RealtimeChannel {
  /** Row changes on a table, or a named broadcast channel when `broadcast` is set. */
  table?: string;
  filter?: { column: string; value: string };
  broadcast?: { channel: string; event: string };
}

/** Returns an unsubscribe function. */
export type SubscribeFn = (
  channel: RealtimeChannel,
  onChange: (change: RealtimeChange) => void,
) => () => void;
