import type { FetchLike, HeadwaysRun } from '../headways-client.ts';

export interface FakeCall {
  method: string;
  path: string;
  apiKey: string;
  org: string | null;
  body: Record<string, unknown> | null;
}

/** In-memory stand-in for the Headways workspace API routes the adapter calls. */
export class FakeHeadways {
  readonly calls: FakeCall[] = [];
  readonly workstreams = new Map<string, { id: string; goal: string; owner: string }>();
  readonly runs = new Map<string, HeadwaysRun>();
  readonly messages = new Map<string, { threadId: string; content: string }>();
  /** Runs the worker has not written yet answer 404, like the real GET before ensureRunRow. */
  readonly pendingRows = new Set<string>();
  failNext: { path: RegExp; status: number } | null = null;
  private counter = 0;

  readonly fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const apiKey = (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const method = init.method ?? 'GET';
    this.calls.push({
      method,
      path: url.pathname,
      apiKey,
      org: headers.get('x-headways-org'),
      body,
    });
    if (this.failNext && this.failNext.path.test(url.pathname)) {
      const { status } = this.failNext;
      this.failNext = null;
      return json({ error: { code: 'FORCED', message: 'forced failure' } }, status);
    }
    return this.route(method, url.pathname, apiKey, body ?? {});
  };

  setStatus(runId: string, patch: Partial<HeadwaysRun>): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`no run ${runId}`);
    this.pendingRows.delete(runId);
    Object.assign(run, patch);
  }

  private id(prefix: string): string {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }

  /** Headways lets only the Workstream owner read or cancel its runs, even for the org owner. */
  private isCollaborator(run: HeadwaysRun, apiKey: string): boolean {
    const owner = this.workstreams.get(run.workstreamId)?.owner;
    return owner === undefined || owner === apiKey;
  }

  private route(method: string, path: string, apiKey: string, body: Record<string, unknown>) {
    let m: RegExpMatchArray | null;
    if (method === 'POST' && path === '/v1/workspace/workstreams') {
      const id = this.id('ws');
      this.workstreams.set(id, { id, goal: String(body.goal), owner: apiKey });
      return json({ id, goal: body.goal, personalThreadId: this.id('pt') }, 201);
    }
    if (method === 'POST' && (m = path.match(/^\/v1\/workspace\/workstreams\/([^/]+)\/threads$/))) {
      if (!this.workstreams.has(m[1]!)) return json({ error: { code: 'NOT_FOUND' } }, 404);
      return json({ id: this.id('th'), type: body.type }, 201);
    }
    if (method === 'POST' && (m = path.match(/^\/v1\/workspace\/threads\/([^/]+)\/messages$/))) {
      const id = this.id('msg');
      this.messages.set(id, { threadId: m[1]!, content: String(body.content) });
      return json({ id }, 201);
    }
    if (method === 'POST' && (m = path.match(/^\/v1\/workspace\/workstreams\/([^/]+)\/runs$/))) {
      const id = this.id('run');
      const run: HeadwaysRun = {
        id,
        workstreamId: m[1]!,
        threadId: String(body.threadId),
        status: 'queued',
        startedAt: null,
        endedAt: null,
        tokensInput: 0,
        tokensOutput: 0,
        costUsd: 0,
        budgetUsdMax: Number(body.budgetUsdMax ?? 5),
        narration: null,
        failureReason: null,
        cancellationReason: null,
        createdAt: new Date(0).toISOString(),
      };
      this.runs.set(id, run);
      this.pendingRows.add(id);
      return json(run, 201);
    }
    if (method === 'GET' && (m = path.match(/^\/v1\/workspace\/runs\/([^/]+)$/))) {
      const run = this.runs.get(m[1]!);
      if (!run || this.pendingRows.has(run.id)) return json({ error: { code: 'NOT_FOUND' } }, 404);
      if (!this.isCollaborator(run, apiKey)) return notCollaborator();
      return json(run, 200);
    }
    if (method === 'POST' && (m = path.match(/^\/v1\/workspace\/runs\/([^/]+)\/cancel$/))) {
      const run = this.runs.get(m[1]!);
      if (!run) return json({ error: { code: 'NOT_FOUND' } }, 404);
      if (!this.isCollaborator(run, apiKey)) return notCollaborator();
      run.status = 'cancelled';
      run.cancellationReason = 'user_cancelled';
      return json({ id: run.id, status: 'cancelled' }, 200);
    }
    return json({ error: { code: 'NOT_FOUND', message: `${method} ${path}` } }, 404);
  }
}

function notCollaborator(): Response {
  return json({ error: { code: 'FORBIDDEN', message: 'not a collaborator' } }, 403);
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
