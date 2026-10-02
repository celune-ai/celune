import { isCoreError } from '@celuneai/core';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodType } from 'zod';

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly body: Record<string, unknown>;

  constructor(status: ContentfulStatusCode, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = { error: message, ...extra };
  }
}

export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const LOG_MESSAGE_MAX = 500;

/** Keeps a caller's x-request-id when it is short and plain; otherwise mints one. */
export function requestIdFor(incoming: string | undefined | null): string {
  return incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

function currentRequestId(c: Context): string {
  const existing = c.get('requestId') as string | undefined;
  if (existing) return existing;
  const id = requestIdFor(c.req.header(REQUEST_ID_HEADER));
  c.set('requestId', id);
  return id;
}

/** Name, code, and message only. Stacks, request bodies, and headers stay out of the log. */
function describeError(error: unknown): string {
  let text: string;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    text = `${error.name}${typeof code === 'string' && code ? ` [${code}]` : ''}: ${error.message}`;
  } else if (error && typeof error === 'object') {
    const { message, code } = error as { message?: unknown; code?: unknown };
    text = `${typeof code === 'string' ? `[${code}] ` : ''}${typeof message === 'string' ? message : 'non-Error object thrown'}`;
  } else {
    text = `non-Error thrown (${typeof error})`;
  }
  return text.replace(/\s+/g, ' ').slice(0, LOG_MESSAGE_MAX);
}

/**
 * Maps any thrown value to a response. Typed errors keep their status and
 * code. Anything else is logged with the route and request id and answered
 * with `{ error: 'internal_error', request_id }`.
 */
export function errorToResponse(c: Context, error: unknown): Response {
  if (error instanceof HttpError) return c.json(error.body, error.status);
  if (isCoreError(error)) {
    const status = error.status as ContentfulStatusCode;
    if (error.code === 'gate_denied' && error.details) return c.json(error.details, status);
    if (error.code === 'not_found') return c.json({ error: 'Resource not found' }, 404);
    return c.json({ error: error.message, code: error.code }, status);
  }
  const requestId = currentRequestId(c);
  console.error(
    `[celune-api] internal_error request_id=${requestId} route="${c.req.method} ${c.req.path}" error="${describeError(error)}"`,
  );
  return c.json({ error: 'internal_error', request_id: requestId }, 500, {
    [REQUEST_ID_HEADER]: requestId,
  });
}

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(raw ?? {});
  if (!result.success) {
    throw new HttpError(400, 'Invalid request body', { issues: result.error.issues });
  }
  return result.data;
}

export function parseQuery<T>(c: Context, schema: ZodType<T>): T {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    throw new HttpError(400, 'Invalid query', { issues: result.error.issues });
  }
  return result.data;
}
