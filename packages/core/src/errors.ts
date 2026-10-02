export type CoreErrorCode =
  | 'not_found'
  | 'validation'
  | 'invalid_transition'
  | 'task_blocked'
  | 'dependency'
  | 'gate_denied'
  | 'unavailable'
  | 'conflict';

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: CoreErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFound extends CoreError {
  constructor(entity: string, id: string) {
    super('not_found', `${entity} not found: ${id}`, 404, { entity, id });
    this.name = 'NotFound';
  }
}

export class ValidationError extends CoreError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('validation', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class InvalidTransition extends CoreError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super('invalid_transition', `Invalid status transition: ${from} -> ${to}`, 409, { from, to });
    this.name = 'InvalidTransition';
    this.from = from;
    this.to = to;
  }
}

export class TaskBlocked extends CoreError {
  constructor(taskId: string, reason: string | undefined) {
    super('task_blocked', reason ? `Task is blocked: ${reason}` : 'Task is blocked', 409, {
      taskId,
      reason: reason ?? null,
    });
    this.name = 'TaskBlocked';
  }
}

export class DependencyError extends CoreError {
  constructor(message: string, details?: Record<string, unknown>, status = 400) {
    super('dependency', message, status, details);
    this.name = 'DependencyError';
  }
}

export class GateDenied extends CoreError {
  readonly feature: string;
  readonly reason: string;
  readonly upgradeUrl: string | undefined;

  constructor(
    feature: string,
    reason: string,
    options?: { status?: number; upgradeUrl?: string; details?: Record<string, unknown> },
  ) {
    super('gate_denied', reason, options?.status ?? 403, options?.details);
    this.name = 'GateDenied';
    this.feature = feature;
    this.reason = reason;
    this.upgradeUrl = options?.upgradeUrl;
  }
}

/** The row changed between read and write; the caller may retry. */
export class Conflict extends CoreError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('conflict', message, 409, details);
    this.name = 'Conflict';
  }
}

/** A compare-and-set task update found a different status than the caller read. */
export function statusConflict(taskId: string, expectedStatus: string): Conflict {
  return new Conflict('Task status changed before the update; read it again and retry', {
    taskId,
    expectedStatus,
  });
}

/** A feature the host has not configured, such as attachment storage. */
export class Unavailable extends CoreError {
  constructor(message: string) {
    super('unavailable', message, 501);
    this.name = 'Unavailable';
  }
}

export function isCoreError(error: unknown): error is CoreError {
  return error instanceof CoreError;
}

/**
 * A storage failure, such as a PostgREST error object. Stores throw this
 * instead of the raw object so hosts log and map it like any other Error.
 * The message is the driver's message; it carries no request body.
 */
export class StoreError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

/** Returns Errors unchanged and wraps anything else (plain error objects, strings) in a StoreError. */
export function toStoreError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object') {
    const { message, code } = error as { message?: unknown; code?: unknown };
    return new StoreError(
      typeof message === 'string' && message ? message : 'Store request failed',
      typeof code === 'string' && code ? code : null,
    );
  }
  return new StoreError(typeof error === 'string' && error ? error : 'Store request failed');
}
