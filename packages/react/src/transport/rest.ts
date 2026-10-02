import type { ActivityEntry, Project, Task, TaskAttachment, TaskComment } from '@repo/types';
import {
  CeluneTransportError,
  type AttachmentUploadResult,
  type CeluneTransport,
  type ContextEntry,
  type ExecutionRecord,
  type ProgressLogEntry,
  type TaskChildren,
} from './types';

export interface RestTransportOptions {
  /** Base URL of the @celuneai/api mount, for example `https://host/api/v1` or `http://localhost:8787/v1`. */
  apiUrl: string;
  /** Returns the current bearer token. Called on every request. */
  getToken: () => string | null | undefined;
  /** Optional workspace override; host JWTs are already scoped to one workspace. */
  workspaceId?: string;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined>;

function parseText(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Transport for the @celuneai/api REST surface (`/v1/tasks`, `/v1/projects`, ...). Every call stays on that mount. */
export function createRestTransport(options: RestTransportOptions): CeluneTransport {
  const base = options.apiUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  function url(path: string, query?: Query, workspaceId = options.workspaceId): string {
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspace_id', workspaceId);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    return `${base}${path}${qs ? `?${qs}` : ''}`;
  }

  function authHeaders(): Record<string, string> {
    const token = options.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function send<T>(method: string, target: string, body?: unknown, form?: FormData) {
    const headers = authHeaders();
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await doFetch(target, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const parsed = parseText(await res.text());
    if (!res.ok) throw new CeluneTransportError(res.status, parsed);
    return parsed as T;
  }

  function request<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
    return send<T>(method, url(path, query), body);
  }

  function uploadWithProgress(
    target: string,
    form: FormData,
    onProgress: (fraction: number) => void,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
      xhr.addEventListener('load', () => {
        const data = parseText(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new CeluneTransportError(xhr.status, data));
          return;
        }
        resolve(data);
      });
      xhr.addEventListener('error', () => reject(new CeluneTransportError(0, 'Upload failed')));
      xhr.open('POST', target);
      for (const [key, value] of Object.entries(authHeaders())) xhr.setRequestHeader(key, value);
      xhr.send(form);
    });
  }

  return {
    tasks: {
      list: (p = {}) =>
        request<Task[]>('GET', '/tasks', {
          project_id: p.projectId,
          status: p.status,
          limit: p.pageSize,
          offset: p.offset && p.offset > 0 ? p.offset : undefined,
          top_level_only: true,
        }),
      count: async (p = {}) =>
        (await request<{ count: number }>('GET', '/tasks/count', { project_id: p.projectId }))
          .count,
      get: (id) => request<Task>('GET', `/tasks/${id}`),
      create: (input) => request<Task>('POST', '/tasks', undefined, input),
      update: (id, patch) => request<Task>('PATCH', `/tasks/${id}`, undefined, patch),
      remove: async (id) => {
        await request<unknown>('DELETE', `/tasks/${id}`);
      },
      reorder: async (items) => {
        await request<unknown>('PUT', '/tasks/reorder', undefined, items);
      },
      dependencies: async (id) =>
        (await request<{ dependencies?: Task[] }>('GET', `/tasks/${id}/dependencies`))
          .dependencies ?? [],
      children: async (id): Promise<TaskChildren> => {
        const data = await request<{ children?: Task[]; all_complete?: boolean }>(
          'GET',
          `/tasks/${id}/children`,
        );
        return { children: data.children ?? [], allComplete: data.all_complete ?? true };
      },
      spawned: async (id) =>
        (await request<{ tasks?: Task[] }>('GET', `/tasks/${id}/spawned`)).tasks ?? [],
      context: async (id) =>
        (await request<{ entries?: ContextEntry[] }>('GET', `/tasks/${id}/context`)).entries ?? [],
      usage: (id) => request<unknown>('GET', `/tasks/${id}/usage`),
      initiate: (id) => request<Task>('POST', `/tasks/${id}/initiate`),
    },
    comments: {
      list: (taskId) => request<TaskComment[]>('GET', `/tasks/${taskId}/comments`),
      create: (taskId, input) =>
        send<TaskComment>(
          'POST',
          url(`/tasks/${taskId}/comments`, undefined, input.workspaceId ?? options.workspaceId),
          { content: input.content, author: input.author },
        ),
    },
    activity: {
      list: async ({ taskId, limit }) =>
        (
          await request<{ data: ActivityEntry[] }>('GET', '/activity', {
            task_id: taskId,
            limit,
          })
        ).data,
    },
    projects: {
      list: () => request<Project[]>('GET', '/projects'),
      reorder: async (items) => {
        await request<unknown>('PUT', '/projects/reorder', undefined, items);
      },
      progressLog: async (projectId) =>
        (
          await request<{ entries?: ProgressLogEntry[] }>(
            'GET',
            `/projects/${projectId}/progress-log`,
          )
        ).entries ?? [],
    },
    attachments: {
      list: async (taskId) =>
        (await request<TaskAttachment[] | null>('GET', `/tasks/${taskId}/attachments`)) ?? [],
      upload: async (taskId, files, uploadOptions = {}): Promise<AttachmentUploadResult> => {
        const form = new FormData();
        for (const file of files) form.append('files', file);
        form.append('uploaded_by', uploadOptions.uploadedBy ?? 'user');
        const target = url(`/tasks/${taskId}/attachments`);
        const { onProgress } = uploadOptions;
        const data =
          onProgress && typeof XMLHttpRequest !== 'undefined'
            ? await uploadWithProgress(target, form, onProgress)
            : await send<unknown>('POST', target, undefined, form);
        const body = (data ?? {}) as Partial<AttachmentUploadResult>;
        return { attachments: body.attachments ?? [], errors: body.errors ?? [] };
      },
      remove: async (taskId, attachmentId) => {
        await request<unknown>('DELETE', `/tasks/${taskId}/attachments/${attachmentId}`);
      },
    },
    executions: {
      list: async ({ taskId, workspaceId, limit }) =>
        (
          await send<{ executions?: ExecutionRecord[] }>(
            'GET',
            url('/executions', { task_id: taskId, limit }, workspaceId ?? options.workspaceId),
          )
        ).executions ?? [],
      cancel: async ({ taskId, workspaceId }) => {
        await send<unknown>(
          'POST',
          url('/executions/cancel', undefined, workspaceId ?? options.workspaceId),
          { task_id: taskId },
        );
      },
    },
  };
}
