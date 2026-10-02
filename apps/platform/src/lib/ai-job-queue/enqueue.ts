/**
 * Job enqueue helper for IDE-First AI Execution.
 *
 * Usage:
 *   const job = await enqueueAiJob(supabase, {
 *     workspaceId, orgId, requesterId,
 *     jobType: 'chat',
 *     messages: [...],
 *     systemPrompt: '...',
 *     callbackType: 'pr_review',
 *     callbackMetadata: { prId: '...' },
 *   });
 */

import type { createServiceClient } from '@repo/db/service';

type ServiceClient = ReturnType<typeof createServiceClient>;
import { encryptPayload, signJobHmac } from './crypto';

export type AiJobType = 'chat' | 'completion' | 'embedding' | 'structured_output';

export interface EnqueueJobParams {
  workspaceId: string;
  orgId: string;
  requesterId: string;

  jobType: AiJobType;
  model?: string;
  provider?: string;
  priority?: number;

  // Payload — at least one of messages, inputText, or systemPrompt
  messages?: Array<{ role: string; content: string }>;
  inputText?: string;
  systemPrompt?: string;
  tools?: unknown[];
  outputSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;

  // Queue
  queueName?: string;
  estimatedTokens?: number;
  metadata?: Record<string, unknown>;

  // Callback
  callbackType?: string;
  callbackMetadata?: Record<string, unknown>;

  // Timeouts (ms)
  scheduleToStartMs?: number;
  startToCloseMs?: number;
  heartbeatIntervalMs?: number;
  maxAttempts?: number;
}

export interface EnqueuedJob {
  id: string;
  status: string;
  jobType: AiJobType;
  createdAt: string;
}

/**
 * Enqueue an AI job for IDE execution.
 *
 * Encrypts sensitive payloads (messages, system prompt, input text) with AES-256-GCM.
 * Signs the job with HMAC-SHA256 for integrity verification.
 */
export async function enqueueAiJob(
  supabase: ServiceClient,
  params: EnqueueJobParams,
): Promise<EnqueuedJob> {
  // Validate payload size (500KB cap)
  const payloadSize = estimatePayloadSize(params);
  if (payloadSize > 500_000) {
    throw new Error(`Job payload exceeds 500KB cap (${Math.round(payloadSize / 1000)}KB)`);
  }

  // Check queue depth limit per workspace
  const { count: activeCount } = await supabase
    .from('ai_job_queue')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', params.workspaceId)
    .in('status', ['pending', 'claimed', 'streaming']);

  if ((activeCount ?? 0) >= 100) {
    throw new Error('Queue depth limit reached (100 active jobs). Wait for jobs to complete.');
  }

  // Generate nonce for HMAC
  const nonce = crypto.randomUUID();

  // Pre-compute HMAC (needs jobId — we'll use a temp UUID, then update after insert)
  // Actually: generate the ID client-side so we can sign it before insert
  const jobId = crypto.randomUUID();

  const jobHmac = signJobHmac({
    jobId,
    jobType: params.jobType,
    model: params.model ?? 'claude-sonnet-4-20250514',
    nonce,
    workspaceId: params.workspaceId,
  });

  // Encrypt sensitive fields
  const encrypted: Record<string, Buffer | null> = {
    messages_encrypted: null,
    messages_iv: null,
    input_text_encrypted: null,
    input_text_iv: null,
    system_prompt_encrypted: null,
    system_prompt_iv: null,
  };

  if (params.messages) {
    const { encrypted: enc, iv } = encryptPayload(JSON.stringify(params.messages));
    encrypted.messages_encrypted = enc;
    encrypted.messages_iv = iv;
  }

  if (params.inputText) {
    const { encrypted: enc, iv } = encryptPayload(params.inputText);
    encrypted.input_text_encrypted = enc;
    encrypted.input_text_iv = iv;
  }

  if (params.systemPrompt) {
    const { encrypted: enc, iv } = encryptPayload(params.systemPrompt);
    encrypted.system_prompt_encrypted = enc;
    encrypted.system_prompt_iv = iv;
  }

  // Build the row — Supabase client handles BYTEA as base64 strings
  const row = {
    id: jobId,
    workspace_id: params.workspaceId,
    org_id: params.orgId,
    requester_id: params.requesterId,
    job_type: params.jobType,
    model: params.model ?? 'claude-sonnet-4-20250514',
    provider: params.provider ?? 'anthropic',
    priority: params.priority ?? 0,

    // Encrypted payloads — convert Buffer to base64 for Supabase BYTEA
    messages_encrypted: encrypted.messages_encrypted
      ? bufferToBase64(encrypted.messages_encrypted)
      : null,
    messages_iv: encrypted.messages_iv ? bufferToBase64(encrypted.messages_iv) : null,
    input_text_encrypted: encrypted.input_text_encrypted
      ? bufferToBase64(encrypted.input_text_encrypted)
      : null,
    input_text_iv: encrypted.input_text_iv ? bufferToBase64(encrypted.input_text_iv) : null,
    system_prompt_encrypted: encrypted.system_prompt_encrypted
      ? bufferToBase64(encrypted.system_prompt_encrypted)
      : null,
    system_prompt_iv: encrypted.system_prompt_iv
      ? bufferToBase64(encrypted.system_prompt_iv)
      : null,

    // Non-encrypted fields
    tools: params.tools ?? null,
    output_schema: params.outputSchema ?? null,
    max_tokens: params.maxTokens ?? 4096,
    temperature: params.temperature ?? 0.7,

    queue_name: params.queueName ?? 'default',
    estimated_tokens: params.estimatedTokens ?? null,
    metadata: params.metadata ?? {},
    callback_type: params.callbackType ?? null,
    callback_metadata: params.callbackMetadata ?? {},

    // Timeouts
    schedule_to_start_ms: params.scheduleToStartMs ?? 60000,
    start_to_close_ms: params.startToCloseMs ?? 300000,
    heartbeat_interval_ms: params.heartbeatIntervalMs ?? 15000,
    max_attempts: params.maxAttempts ?? 3,

    // Security
    job_hmac: jobHmac,
    nonce,
  };

  const { data, error } = await supabase
    .from('ai_job_queue')
    .insert(row)
    .select('id, status, job_type, created_at')
    .single();

  if (error) {
    throw new Error(`Failed to enqueue AI job: ${error.message}`);
  }

  return {
    id: data.id,
    status: data.status,
    jobType: data.job_type,
    createdAt: data.created_at,
  };
}

/** Estimate payload size in bytes for the 500KB cap check. */
function estimatePayloadSize(params: EnqueueJobParams): number {
  let size = 0;
  if (params.messages) size += JSON.stringify(params.messages).length;
  if (params.inputText) size += params.inputText.length;
  if (params.systemPrompt) size += params.systemPrompt.length;
  if (params.tools) size += JSON.stringify(params.tools).length;
  if (params.outputSchema) size += JSON.stringify(params.outputSchema).length;
  return size;
}

/** Convert a Node.js Buffer to a base64 string with Supabase BYTEA prefix. */
function bufferToBase64(buf: Buffer): string {
  return '\\x' + buf.toString('hex');
}
