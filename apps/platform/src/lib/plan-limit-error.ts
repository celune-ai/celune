/**
 * Structured error thrown when a 403 response contains `error: 'plan_limit'`.
 * Carries the limit metadata so the UI can display contextual upgrade CTAs.
 */
export interface PlanLimitPayload {
  error: 'plan_limit';
  limit: string;
  current: number;
  max: number;
  plan: string;
  upgrade_url: string;
}

export class PlanLimitError extends Error {
  readonly payload: PlanLimitPayload;

  constructor(payload: PlanLimitPayload) {
    super(`Plan limit reached: ${payload.limit} (${payload.current}/${payload.max})`);
    this.name = 'PlanLimitError';
    this.payload = payload;
  }
}

/**
 * Check whether an error is a PlanLimitError.
 */
export function isPlanLimitError(err: unknown): err is PlanLimitError {
  return err instanceof PlanLimitError;
}

/**
 * Try to parse a non-ok Response as a plan limit error.
 * Returns PlanLimitPayload if it is one, otherwise null.
 */
export async function parsePlanLimitResponse(res: Response): Promise<PlanLimitPayload | null> {
  if (res.status !== 403) return null;
  try {
    const data = await res.clone().json();
    if (data?.error === 'plan_limit' && typeof data.limit === 'string') {
      return data as PlanLimitPayload;
    }
  } catch {
    // Not JSON or not plan_limit — ignore
  }
  return null;
}
