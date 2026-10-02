import { createServiceClient } from '@repo/db/service';
import type { UsageEventType, UsageUnit } from '@repo/types';

interface TrackUsageParams {
  workspace_id: string;
  org_id?: string | null;
  user_id?: string | null;
  event_type: UsageEventType;
  quantity: number;
  unit?: UsageUnit;
  metadata?: Record<string, unknown>;
}

/**
 * Log a usage event asynchronously. Fire-and-forget — errors are swallowed
 * so callers are never blocked by metering failures.
 *
 * Usage:
 *   trackUsage({
 *     workspace_id: 'xxx',
 *     event_type: 'llm_tokens',
 *     quantity: 1500,
 *     unit: 'tokens',
 *     metadata: { model: 'claude-sonnet-4-6', agent: 'rick' },
 *   });
 */
export function trackUsage(params: TrackUsageParams): void {
  // Fire-and-forget — don't await, don't block the caller
  void trackUsageAsync(params);
}

async function trackUsageAsync(params: TrackUsageParams): Promise<void> {
  try {
    // Service client: writes metering events that users must not be able to modify or delete. Accesses: usage_events.
    const supabase = createServiceClient();
    await supabase.from('usage_events').insert({
      workspace_id: params.workspace_id,
      org_id: params.org_id ?? null,
      user_id: params.user_id ?? null,
      event_type: params.event_type,
      quantity: params.quantity,
      unit: params.unit ?? 'count',
      metadata: params.metadata ?? {},
    });
  } catch {
    // Swallow errors — metering should never break the request
    if (process.env.NODE_ENV === 'development') {
      console.warn('[trackUsage] Failed to log usage event:', params.event_type);
    }
  }
}

/**
 * Track usage and decrement trial budget if the key source is 'trial'.
 * Call this after any AI operation that consumed tokens using a trial key.
 *
 * @param workspaceId - The workspace whose trial budget to decrement
 * @param tokensUsed  - Number of tokens consumed (input + output)
 * @param keySource   - Where the API key came from ('trial' triggers budget decrement)
 */
export function trackTrialUsage(workspaceId: string, tokensUsed: number, keySource: string): void {
  if (keySource !== 'trial' || tokensUsed <= 0) return;
  void decrementTrialBudget(workspaceId, tokensUsed);
}

async function decrementTrialBudget(workspaceId: string, tokens: number): Promise<void> {
  try {
    const supabase = createServiceClient();
    // Atomic increment of trial_tokens_used
    await supabase.rpc('increment_trial_tokens', {
      p_workspace_id: workspaceId,
      p_tokens: tokens,
    });
  } catch {
    // Fire-and-forget — log in dev, never block the caller
    if (process.env.NODE_ENV === 'development') {
      console.warn('[trackTrialUsage] Failed to decrement trial budget:', workspaceId);
    }
  }
}

/**
 * Batch-insert multiple usage events at once.
 * Useful for bulk operations like cost ingest.
 */
export function trackUsageBatch(events: TrackUsageParams[]): void {
  void trackUsageBatchAsync(events);
}

async function trackUsageBatchAsync(events: TrackUsageParams[]): Promise<void> {
  if (events.length === 0) return;
  try {
    // Service client: batch-inserts metering events that users must not be able to modify or delete. Accesses: usage_events.
    const supabase = createServiceClient();
    await supabase.from('usage_events').insert(
      events.map((e) => ({
        workspace_id: e.workspace_id,
        org_id: e.org_id ?? null,
        user_id: e.user_id ?? null,
        event_type: e.event_type,
        quantity: e.quantity,
        unit: e.unit ?? 'count',
        metadata: e.metadata ?? {},
      })),
    );
  } catch {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[trackUsageBatch] Failed to log', events.length, 'usage events');
    }
  }
}
