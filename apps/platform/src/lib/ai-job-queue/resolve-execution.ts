/**
 * AI Execution Resolver — decides how to execute an AI call.
 *
 * Decision tree:
 *   1. Check if workspace has a connected IDE (active api_key with recent last_used_at)
 *   2. If IDE connected → enqueue to job queue (async, IDE executes)
 *   3. If no IDE → fall back to resolveProviderKey() (BYOK / platform / trial)
 *
 * This is the primary entry point for all AI features to use instead of
 * calling resolveProviderKey() directly.
 */

import { createServiceClient } from '@repo/db/service';
import {
  resolveProviderKey,
  ProviderKeyRequiredError,
  type Provider,
  type ResolvedProviderKey,
} from '@/lib/resolve-provider-key';
import { enqueueAiJob, type AiJobType, type EnqueuedJob, type EnqueueJobParams } from './enqueue';

/** How the AI call will be executed. */
export type ExecutionMode = 'ide_queue' | 'direct_api';

export interface ExecutionDecision {
  mode: ExecutionMode;
  /** Present when mode=direct_api — the resolved API key. */
  providerKey?: ResolvedProviderKey;
  /** Present when mode=ide_queue — the enqueued job. */
  job?: EnqueuedJob;
}

interface ResolveOptions {
  workspaceId: string;
  orgId: string;
  userId: string;
  provider?: Provider;
  /** If true, skip IDE check and always use direct API (e.g. platform-subsidized calls). */
  forceDirect?: boolean;
  /** Passed through to resolveProviderKey. */
  skipByokGate?: boolean;
}

/**
 * Check if a workspace has an IDE connected (active MCP connection via api_keys).
 *
 * An IDE is considered "connected" if there's an API key that:
 * - Belongs to the workspace
 * - Has been used within the last 2 minutes (heartbeat window)
 * - Is not revoked
 */
async function hasConnectedIde(workspaceId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null)
    .gte('last_used_at', twoMinutesAgo);

  return (count ?? 0) > 0;
}

/**
 * Resolve how to execute an AI call.
 *
 * Returns the execution mode and either a provider key (direct) or job reference (queue).
 * Does NOT enqueue — call `executeViaQueue()` separately with job params.
 */
export async function resolveAiExecution(opts: ResolveOptions): Promise<{
  mode: ExecutionMode;
  providerKey?: ResolvedProviderKey;
  ideConnected: boolean;
}> {
  // Force direct mode (platform-subsidized, onboarding, etc.)
  if (opts.forceDirect) {
    const providerKey = await resolveProviderKey(
      opts.provider ?? 'anthropic',
      opts.orgId,
      opts.workspaceId,
      { userId: opts.userId, skipByokGate: opts.skipByokGate },
    );
    return { mode: 'direct_api', providerKey, ideConnected: false };
  }

  // Check for connected IDE
  const ideConnected = await hasConnectedIde(opts.workspaceId);

  if (ideConnected) {
    // IDE is connected — prefer job queue
    return { mode: 'ide_queue', ideConnected: true };
  }

  // No IDE — try BYOK / platform key fallback
  try {
    const providerKey = await resolveProviderKey(
      opts.provider ?? 'anthropic',
      opts.orgId,
      opts.workspaceId,
      { userId: opts.userId, skipByokGate: opts.skipByokGate },
    );
    return { mode: 'direct_api', providerKey, ideConnected: false };
  } catch (err) {
    if (err instanceof ProviderKeyRequiredError) {
      // No BYOK and no trial — user needs to connect IDE
      throw new IdeConnectionRequiredError(err.provider);
    }
    throw err;
  }
}

/**
 * Enqueue an AI job to the IDE queue.
 * Call this after resolveAiExecution() returns mode='ide_queue'.
 */
export async function executeViaQueue(
  params: Omit<EnqueueJobParams, 'workspaceId' | 'orgId' | 'requesterId'> & {
    workspaceId: string;
    orgId: string;
    requesterId: string;
  },
): Promise<EnqueuedJob> {
  const supabase = createServiceClient();
  return enqueueAiJob(supabase, params);
}

/**
 * Error thrown when no execution path is available.
 * The user must connect their IDE or add an API key.
 */
export class IdeConnectionRequiredError extends Error {
  public readonly provider: Provider;

  constructor(provider: Provider) {
    super(
      'No AI execution path available. Connect your IDE (Claude Code, Cursor, etc.) ' +
        `or add a ${provider} API key in Settings → Integrations.`,
    );
    this.name = 'IdeConnectionRequiredError';
    this.provider = provider;
  }
}
