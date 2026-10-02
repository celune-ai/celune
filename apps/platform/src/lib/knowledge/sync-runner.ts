import { createServiceClient } from '@repo/db/service';
import { CONNECTORS, type ConnectorSyncParams } from './connectors/index';
import type { IngestResult } from './ingest';

// ---------------------------------------------------------------------------
// Retry utility with exponential backoff
// ---------------------------------------------------------------------------

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelay = options?.baseDelayMs ?? 1000;
  const maxDelay = options?.maxDelayMs ?? 30_000;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        console.warn(
          `[${label}] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`,
          lastError.message,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError!;
}

// ---------------------------------------------------------------------------
// Sync runner — wraps connector sync with status tracking + error recovery
// ---------------------------------------------------------------------------

export interface RunSyncParams {
  sourceId: string;
  workspaceId: string;
  syncId?: string;
}

/**
 * Execute a full sync for a knowledge source.
 *
 * - Reads the source record to get provider + connection details
 * - Runs the connector's sync function with retry
 * - Updates source status (active/error) + items_count
 * - Updates sync record with results
 * - Always sets a final status — never leaves source stuck in 'syncing'
 */
export async function runSync(params: RunSyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, syncId } = params;
  const supabase = createServiceClient();
  const startTime = Date.now();

  let result: IngestResult = {
    processed: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  };

  try {
    // Fetch source details
    const { data: source, error: fetchError } = await supabase
      .from('knowledge_sources')
      .select('id, provider, nango_connection_id, config')
      .eq('id', sourceId)
      .single();

    if (fetchError || !source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    const connector = CONNECTORS[source.provider];
    if (!connector) {
      throw new Error(`Unknown provider: ${source.provider}`);
    }

    if (connector.authType === 'upload') {
      throw new Error('Use processUpload() for file uploads');
    }

    const syncParams: ConnectorSyncParams = {
      sourceId,
      workspaceId,
      connectionId: source.nango_connection_id || `${workspaceId}_${source.provider}`,
      options: (source.config as Record<string, string>) ?? undefined,
    };

    // Run sync with retry
    result = await withRetry(() => connector.syncFunction(syncParams), `sync:${source.provider}`, {
      maxRetries: 2,
      baseDelayMs: 2000,
    });

    // Count total items for this source
    const { count } = await supabase
      .from('knowledge_items')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', sourceId);

    const durationMs = Date.now() - startTime;
    const hasErrors = result.errors.length > 0;

    // Update source status
    await supabase
      .from('knowledge_sources')
      .update({
        status: hasErrors ? 'error' : 'active',
        items_count: count ?? 0,
        last_sync_at: new Date().toISOString(),
        last_error: hasErrors ? result.errors.join('; ').slice(0, 1000) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceId);

    // Update sync record if provided
    if (syncId) {
      await supabase
        .from('knowledge_syncs')
        .update({
          status: hasErrors ? 'partial' : 'success',
          items_processed: result.processed,
          items_added: result.added,
          items_updated: result.updated,
          duration_ms: durationMs,
          error_message: hasErrors ? result.errors.join('; ').slice(0, 2000) : null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', syncId);
    }

    console.log(
      `[sync-runner] ${source.provider} complete: ${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged, ${result.errors.length} errors (${durationMs}ms)`,
    );

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;

    console.error(`[sync-runner] ${sourceId} failed:`, errorMessage);

    // Always update source status on failure — never leave stuck in 'syncing'
    try {
      await supabase
        .from('knowledge_sources')
        .update({
          status: 'error',
          last_error: errorMessage.slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceId);
    } catch (e) {
      console.error('[sync-runner] Failed to update source status:', e);
    }

    // Update sync record on failure
    if (syncId) {
      try {
        await supabase
          .from('knowledge_syncs')
          .update({
            status: 'error',
            error_message: errorMessage.slice(0, 2000),
            duration_ms: durationMs,
            completed_at: new Date().toISOString(),
          })
          .eq('id', syncId);
      } catch (e) {
        console.error('[sync-runner] Failed to update sync record:', e);
      }
    }

    result.errors.push(errorMessage);
    return result;
  }
}
