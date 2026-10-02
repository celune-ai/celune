export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HeadwaysClientOptions {
  /** Headways API origin, for example http://localhost:3001. */
  apiUrl: string;
  /** Headways API key of the user the calls act as. */
  apiKey: string;
  /** Org slug sent as x-headways-org. */
  orgSlug: string;
  fetch?: FetchLike;
  /** Per-request timeout, so one hung call cannot stall polling. Default 15 s. */
  timeoutMs?: number;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** The AgentRun fields GET /v1/workspace/runs/:id returns that the adapter reads. */
export interface HeadwaysRun {
  id: string;
  workstreamId: string;
  threadId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  budgetUsdMax: number;
  narration: string | null;
  failureReason: string | null;
  cancellationReason: string | null;
  createdAt: string;
}

export interface CreatedWorkstream {
  id: string;
  personalThreadId: string;
}

export interface CreateRunInput {
  threadId: string;
  model: string;
  budgetUsdMax?: number;
  triggeringMessageId?: string | null;
  skills?: Array<{ slug: string; version: string }>;
  connectors?: Array<{ key: string; name?: string }>;
  clientRequestId: string;
}

export class HeadwaysApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'HeadwaysApiError';
    this.status = status;
    this.code = code;
  }
}

/** Minimal client for the Headways workspace API routes the adapter uses. */
export class HeadwaysClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly orgSlug: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: HeadwaysClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.orgSlug = options.orgSlug;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  createWorkstream(input: { goal: string; clientRequestId: string }): Promise<CreatedWorkstream> {
    return this.request('POST', '/v1/workspace/workstreams', {
      goal: input.goal,
      kind: 'user_initiated',
      clientRequestId: input.clientRequestId,
    });
  }

  /** A group thread, so the brief message does not start a run on its own. */
  createGroupThread(
    workstreamId: string,
    input: { title: string; clientRequestId: string },
  ): Promise<{ id: string }> {
    return this.request('POST', `/v1/workspace/workstreams/${enc(workstreamId)}/threads`, {
      type: 'group',
      title: input.title,
      clientRequestId: input.clientRequestId,
    });
  }

  postMessage(
    threadId: string,
    input: { content: string; clientRequestId: string },
  ): Promise<{ id: string }> {
    return this.request('POST', `/v1/workspace/threads/${enc(threadId)}/messages`, {
      content: input.content,
      mentionsAgent: false,
      clientRequestId: input.clientRequestId,
    });
  }

  createRun(workstreamId: string, input: CreateRunInput): Promise<HeadwaysRun> {
    return this.request('POST', `/v1/workspace/workstreams/${enc(workstreamId)}/runs`, input);
  }

  /** Resolves null while the worker has not written the AgentRun row yet. */
  async getRun(runId: string): Promise<HeadwaysRun | null> {
    try {
      return await this.request<HeadwaysRun>('GET', `/v1/workspace/runs/${enc(runId)}`);
    } catch (error) {
      if (error instanceof HeadwaysApiError && error.status === 404) return null;
      throw error;
    }
  }

  cancelRun(runId: string, clientRequestId: string): Promise<unknown> {
    return this.request('POST', `/v1/workspace/runs/${enc(runId)}/cancel`, { clientRequestId });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'x-headways-org': this.orgSlug,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    const parsed = text ? safeJson(text) : null;
    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
      throw new HeadwaysApiError(
        response.status,
        error?.code ?? null,
        `Headways ${method} ${path} failed with ${response.status}${error?.message ? `: ${error.message}` : ''}`,
      );
    }
    return parsed as T;
  }
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
