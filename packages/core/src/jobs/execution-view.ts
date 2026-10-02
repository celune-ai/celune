import type { ExecutionJob } from '@repo/types';
import type { JobRow } from '../store.ts';

/** Decrypts a stored result; returns the plaintext JSON. Hosts supply it because keys stay with them. */
export type ResultDecryptor = (encryptedHex: string, ivHex: string) => string;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function readOutcome(
  row: JobRow,
  metadata: Record<string, unknown>,
  decrypt: ResultDecryptor | undefined,
): string | null {
  if (typeof metadata.outcome === 'string') return metadata.outcome;
  const enc = row.result_encrypted;
  const iv = row.result_iv;
  if (!decrypt || typeof enc !== 'string' || typeof iv !== 'string') return null;
  try {
    const parsed = JSON.parse(decrypt(enc, iv)) as { content?: unknown };
    return typeof parsed.content === 'string' ? parsed.content : null;
  } catch {
    return null;
  }
}

/** Maps a server job row to the shape the Executions API has always returned. */
export function toExecutionView(row: JobRow, decrypt?: ResultDecryptor): ExecutionJob {
  const metadata = asRecord(row.metadata);
  const lastError = asRecord(row.last_error);
  const targetType =
    row.target_type === 'task' || row.target_type === 'project' ? row.target_type : null;
  return {
    id: row.id,
    workspace_id: String(row.workspace_id ?? ''),
    user_id: String(row.requester_id ?? ''),
    org_id: String(row.org_id ?? ''),
    runner: 'server',
    target_type: targetType,
    task_id: targetType === 'task' ? String(row.target_id) : null,
    project_id: targetType === 'project' ? String(row.target_id) : null,
    status: row.status as ExecutionJob['status'],
    priority: Number(row.priority ?? 0),
    claimed_at: (row.claimed_at as string | null) ?? null,
    started_at: (row.started_at as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    agent_id: typeof metadata.agent_id === 'string' ? metadata.agent_id : 'rick',
    worker_id: (row.worker_id as string | null) ?? null,
    token_budget: row.token_budget == null ? null : Number(row.token_budget),
    tokens_used: Number(row.tokens_used ?? 0),
    timeout_ms: Number(row.start_to_close_ms ?? 0),
    attempt: Number(row.attempt ?? 0),
    max_attempts: Number(row.max_attempts ?? 0),
    context: asRecord(metadata.context),
    outcome: readOutcome(row, metadata, decrypt),
    error_message: typeof lastError.message === 'string' ? lastError.message : null,
    error_code: typeof lastError.code === 'string' ? lastError.code : null,
    metadata,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? row.created_at ?? ''),
  };
}
