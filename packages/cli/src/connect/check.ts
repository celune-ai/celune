import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HARNESS_CONFIG_PATH } from './scaffold.js';

/** A task id no workspace holds. A 404 for it proves auth and routing without changing data. */
export const PROBE_TASK_ID = '00000000-0000-0000-0000-000000000000';

export interface HarnessConfigFile {
  harness: string;
  apiUrl: string;
  workspaceId?: string;
  credentialEnv?: string;
}

export function loadHarnessConfig(root: string, path = HARNESS_CONFIG_PATH): HarnessConfigFile {
  const full = join(root, path);
  let raw: string;
  try {
    raw = readFileSync(full, 'utf8');
  } catch {
    throw new Error(`No ${path} in ${root}. Run connect --write first.`);
  }
  let parsed: Partial<HarnessConfigFile>;
  try {
    parsed = JSON.parse(raw) as Partial<HarnessConfigFile>;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  if (typeof parsed.harness !== 'string' || !parsed.harness) {
    throw new Error(`${path} has no "harness" name`);
  }
  if (typeof parsed.apiUrl !== 'string' || !/^https?:\/\//.test(parsed.apiUrl)) {
    throw new Error(`${path} has no valid "apiUrl"`);
  }
  return parsed as HarnessConfigFile;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https everywhere, plain http only for a loopback host. A key must never cross the network in clear text. */
export function isSafeApiUrl(apiUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * The key saved by `celune setup` belongs to one Celune origin. A repo's
 * committed harness.json must not be able to send it anywhere else.
 */
export function storedKeyAllowed(apiUrl: string, savedUrls: Array<string | undefined>): boolean {
  let target: string;
  try {
    target = new URL(apiUrl).origin;
  } catch {
    return false;
  }
  return savedUrls.some((saved) => {
    if (!saved) return false;
    try {
      return new URL(saved).origin === target;
    } catch {
      return false;
    }
  });
}

export interface CheckOptions {
  apiUrl: string;
  harness: string;
  /** Server credential: an API key with write scope or a server JWT. Never printed. */
  credential: string;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
}

export interface CheckResult {
  ok: boolean;
  status: number | null;
  url: string;
  message: string;
}

/**
 * Posts a `queued` test event for a task that cannot exist. Auth runs before the
 * task lookup, so "Resource not found" means the credential and route work and
 * no task changed.
 */
export async function runHarnessCheck(options: CheckOptions): Promise<CheckResult> {
  const url = `${options.apiUrl.replace(/\/+$/, '')}/v1/harness/events`;
  const now = (options.clock ?? (() => new Date()))();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        event_id: `celune-connect-check:${now.getTime().toString(36)}`,
        task_id: PROBE_TASK_ID,
        harness: options.harness,
        run_id: 'celune-connect-check',
        status: 'queued',
        occurred_at: now.toISOString(),
      }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, url, message: `Could not reach ${url}: ${reason}` };
  }

  const status = response.status;
  const body = await readError(response);
  if (status === 404 && body === 'Resource not found') {
    return {
      ok: true,
      status,
      url,
      message:
        'Credential accepted and the event route answered. The probe task does not exist, so nothing changed.',
    };
  }
  if (status >= 200 && status < 300) {
    return { ok: true, status, url, message: 'Credential accepted and the event was applied.' };
  }
  const detail = body ? `: ${body}` : '';
  const messages: Record<number, string> = {
    400: `Celune refused the test event body (400)${detail}`,
    401: 'Celune refused the credential (401). Check the key in the credential variable.',
    403: `The credential cannot report events (403)${detail}. Use an API key with write scope or a server JWT without a permissions claim.`,
    404: `No harness event route at ${url}. Point apiUrl at the Celune API origin.`,
  };
  return {
    ok: false,
    status,
    url,
    message: messages[status] ?? `Unexpected response ${status}${detail}`,
  };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error.slice(0, 300) : '';
  } catch {
    return '';
  }
}
